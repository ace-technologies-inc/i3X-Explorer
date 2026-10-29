import { useEffect, useMemo, useRef, useState } from 'react'
import type { Neighbor } from './egoGraph'

/** Suggestions shown at once. The text is also the list filter, so refining is cheap. */
const MAX_SUGGESTIONS = 8

/**
 * Compact search box for the Relationships header. One input, two jobs: the
 * text filters the relationship list down as you type, and the autocomplete
 * locates a picked element on the map, zoom to it and spotlight it, without
 * navigating away.
 */
export function RelationshipSearch({
  neighbors,
  query,
  onQueryChange,
  onLocate,
}: {
  /** What the list currently shows; the only things worth suggesting. */
  neighbors: Neighbor[]
  query: string
  onQueryChange: (text: string) => void
  /** A suggestion was picked: zoom to and spotlight this element on the map. */
  onLocate: (elementId: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  const suggestions = useMemo(() => {
    const text = query.trim().toLowerCase()
    if (!text) return []
    const out: Neighbor[] = []
    const seen = new Set<string>()
    for (const neighbor of neighbors) {
      const { displayName, elementId } = neighbor.object
      if (seen.has(elementId)) continue
      if (displayName.toLowerCase().includes(text) || elementId.toLowerCase().includes(text)) {
        seen.add(elementId)
        out.push(neighbor)
        if (out.length >= MAX_SUGGESTIONS) break
      }
    }
    return out
  }, [neighbors, query])

  // A fresh result set starts back at the top; the old index may be out of range.
  useEffect(() => {
    setActiveIndex(0)
  }, [suggestions])

  const pick = (neighbor: Neighbor) => {
    onQueryChange(neighbor.object.displayName)
    onLocate(neighbor.object.elementId)
    setIsOpen(false)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!isOpen) {
        setIsOpen(true)
        return
      }
      if (suggestions.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex(index => (index + step + suggestions.length) % suggestions.length)
    } else if (event.key === 'Enter') {
      if (isOpen && suggestions[activeIndex]) {
        event.preventDefault()
        pick(suggestions[activeIndex])
      } else if (!isOpen && query) {
        setIsOpen(true)
      }
    } else if (event.key === 'Escape') {
      if (isOpen) setIsOpen(false)
      else if (query) onQueryChange('')
    }
  }

  const listboxId = 'relationship-search-listbox'

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={event => {
        // Only a focus leaving the whole widget closes it; moving between the
        // input and an option is internal.
        if (!(event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget))) {
          setIsOpen(false)
        }
      }}
    >
      <div className="flex items-center gap-1.5 bg-i3x-bg border border-i3x-border rounded-lg px-2 py-[5px] focus-within:ring-2 focus-within:ring-i3x-primary">
        <svg viewBox="0 0 16 16" className="w-3 h-3 shrink-0 text-i3x-text-muted" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <line x1="10.6" y1="10.6" x2="14" y2="14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          value={query}
          onChange={event => {
            onQueryChange(event.target.value)
            setIsOpen(true)
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Find related…"
          aria-label="Search relationships"
          role="combobox"
          aria-expanded={isOpen && suggestions.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            isOpen && suggestions[activeIndex]
              ? `relationship-search-option-${activeIndex}`
              : undefined
          }
          spellCheck={false}
          className="w-28 focus:w-44 transition-[width] motion-reduce:transition-none bg-transparent text-[11.5px] text-i3x-text placeholder:text-i3x-text-muted focus:outline-none normal-case tracking-normal"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              onQueryChange('')
              setIsOpen(false)
            }}
            className="shrink-0 -mr-0.5 w-4 h-4 grid place-items-center rounded text-i3x-text-muted hover:text-i3x-text focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
          >
            {/* Drawn, not the × glyph: text baselines sit low, an SVG centres exactly. */}
            <svg viewBox="0 0 16 16" className="w-2.5 h-2.5" aria-hidden="true">
              <line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {isOpen && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Matching relationships"
          className="absolute right-0 top-full mt-1 w-72 max-h-72 overflow-y-auto overscroll-contain bg-i3x-surface border border-i3x-border rounded-lg shadow-lg z-20 py-1 normal-case tracking-normal"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.object.elementId}
              id={`relationship-search-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
            >
              <button
                type="button"
                // Keep focus on the input, so blur doesn't close the list before the click lands.
                onMouseDown={event => event.preventDefault()}
                onClick={() => pick(suggestion)}
                onMouseEnter={() => setActiveIndex(index)}
                title={suggestion.object.elementId}
                className={`w-full flex items-baseline gap-2 px-2.5 py-1.5 text-left focus:outline-none ${
                  index === activeIndex ? 'bg-i3x-bg' : ''
                }`}
              >
                <span className="min-w-0 truncate text-[12.5px] text-i3x-text">
                  {suggestion.object.displayName}
                </span>
                <span className="ml-auto shrink-0 max-w-[45%] truncate font-mono text-[10.5px] text-i3x-text-muted">
                  {suggestion.relationshipType ?? 'Related'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
