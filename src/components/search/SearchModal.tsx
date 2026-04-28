import { useState, useEffect, useCallback, useRef } from 'react'
import { useExplorerStore } from '../../stores/explorer'
import { getClient } from '../../api/client'
import type { ObjectInstance } from '../../api/types'

interface SearchResult {
  object: ObjectInstance
  useHierarchy: boolean
  hierarchyPath: string[]
}

interface SearchModalProps {
  onClose: () => void
}

function buildAncestorPath(obj: ObjectInstance, allObjects: ObjectInstance[]): string[] {
  const path: string[] = []
  const visited = new Set<string>()
  let current = obj
  while (current.parentId && current.parentId !== '/' && !visited.has(current.elementId)) {
    visited.add(current.elementId)
    const parent = allObjects.find(o => o.elementId === current.parentId)
    if (!parent) break
    path.unshift(parent.displayName || parent.elementId)
    current = parent
  }
  return path
}

const MAX_RESULTS = 50

export function SearchModal({ onClose }: SearchModalProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const { selectItem, setAllObjects, setHierarchicalRoots } = useExplorerStore()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Scroll active result into view when keyboard-navigating
  useEffect(() => {
    const active = listRef.current?.querySelector('[data-active="true"]') as HTMLElement | null
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([])
      return
    }

    const client = getClient()
    if (!client) return

    setIsLoading(true)
    try {
      // Use cached store values; fetch if not yet loaded
      let objects = useExplorerStore.getState().allObjects
      let roots = useExplorerStore.getState().hierarchicalRoots

      if (objects.length === 0) {
        objects = await client.getObjects()
        setAllObjects(objects)
      }
      if (roots.length === 0) {
        roots = await client.getObjects(undefined, false, true)
        setHierarchicalRoots(roots)
      }

      const lower = searchQuery.toLowerCase()
      const rootIds = new Set(roots.map(r => r.elementId))

      const matches = objects
        .filter(obj =>
          (obj.displayName && obj.displayName.toLowerCase().includes(lower)) ||
          obj.elementId.toLowerCase().includes(lower)
        )
        .slice(0, MAX_RESULTS)

      const searchResults: SearchResult[] = matches.map(obj => {
        const useHierarchy = rootIds.has(obj.elementId) || !!(obj.parentId && obj.parentId !== '/')
        return {
          object: obj,
          useHierarchy,
          hierarchyPath: useHierarchy ? buildAncestorPath(obj, objects) : [],
        }
      })

      // Hierarchy matches first, then alphabetical within each group
      searchResults.sort((a, b) => {
        if (a.useHierarchy !== b.useHierarchy) return a.useHierarchy ? -1 : 1
        const aLabel = a.object.displayName || a.object.elementId
        const bLabel = b.object.displayName || b.object.elementId
        return aLabel.localeCompare(bLabel)
      })

      setResults(searchResults)
      setActiveIndex(0)
    } finally {
      setIsLoading(false)
    }
  }, [setAllObjects, setHierarchicalRoots])

  useEffect(() => {
    const timer = setTimeout(() => performSearch(query), 250)
    return () => clearTimeout(timer)
  }, [query, performSearch])

  const navigateTo = useCallback(async (result: SearchResult) => {
    const client = getClient()
    if (!client) return

    const { expandedNodes } = useExplorerStore.getState()
    const newExpanded = new Set(expandedNodes)

    if (result.useHierarchy) {
      // Ensure roots are loaded so the Hierarchy folder renders correctly
      let roots = useExplorerStore.getState().hierarchicalRoots
      if (roots.length === 0) {
        roots = await client.getObjects(undefined, false, true)
        setHierarchicalRoots(roots)
      }

      newExpanded.add('folder:hierarchical')

      // Expand every ancestor in the parentId chain so the target node is visible
      const objects = useExplorerStore.getState().allObjects
      const visited = new Set<string>()
      let current = result.object
      while (current.parentId && current.parentId !== '/' && !visited.has(current.elementId)) {
        visited.add(current.elementId)
        const parent = objects.find(o => o.elementId === current.parentId)
        if (!parent) break
        newExpanded.add(`hier:${parent.elementId}`)
        current = parent
      }

      useExplorerStore.setState({ expandedNodes: newExpanded })
      selectItem({ type: 'object', id: `hier:${result.object.elementId}`, data: result.object })
    } else {
      newExpanded.add('folder:objects')
      useExplorerStore.setState({ expandedNodes: newExpanded })
      selectItem({ type: 'object', id: `obj:${result.object.elementId}`, data: result.object })
    }

    onClose()
  }, [selectItem, setHierarchicalRoots, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        onClose()
        break
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex(i => Math.min(i + 1, results.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex(i => Math.max(i - 1, 0))
        break
      case 'Enter':
        if (results[activeIndex]) navigateTo(results[activeIndex])
        break
    }
  }, [onClose, results, activeIndex, navigateTo])

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 pt-24"
      onClick={onClose}
    >
      <div
        className="bg-i3x-surface rounded-lg shadow-xl w-full max-w-lg border border-i3x-border"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-i3x-border">
          <span className="text-i3x-text-muted text-base flex-shrink-0">🔍</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search objects by name or ID…"
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIndex(0) }}
            className="flex-1 bg-transparent text-sm text-i3x-text outline-none placeholder:text-i3x-text-muted"
          />
          {isLoading && (
            <span className="text-xs text-i3x-text-muted flex-shrink-0">Searching…</span>
          )}
          <button
            onClick={onClose}
            className="text-i3x-text-muted hover:text-i3x-text text-xl leading-none flex-shrink-0"
          >
            ×
          </button>
        </div>

        {/* Results list */}
        {results.length > 0 && (
          <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
            {results.map((result, i) => {
              const label = result.object.displayName || result.object.elementId
              return (
                <button
                  key={result.object.elementId}
                  data-active={i === activeIndex ? 'true' : 'false'}
                  onClick={() => navigateTo(result)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`w-full text-left px-4 py-2.5 flex items-start gap-3 transition-colors ${
                    i === activeIndex ? 'bg-i3x-bg' : ''
                  }`}
                >
                  <span className="text-base flex-shrink-0 mt-0.5">
                    {result.object.isComposition ? '📦' : '🗒️'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-i3x-text truncate">{label}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded border flex-shrink-0 ${
                        result.useHierarchy
                          ? 'bg-i3x-success/10 text-i3x-success border-i3x-success/20'
                          : 'bg-i3x-primary/10 text-i3x-primary border-i3x-primary/20'
                      }`}>
                        {result.useHierarchy ? 'Hierarchy' : 'Objects'}
                      </span>
                    </div>
                    {result.hierarchyPath.length > 0 && (
                      <div className="text-xs text-i3x-text-muted truncate mt-0.5">
                        {result.hierarchyPath.join(' › ')}
                      </div>
                    )}
                    <div className="text-xs text-i3x-text-muted/60 truncate mt-0.5 font-mono">
                      {result.object.elementId}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Empty state */}
        {query && !isLoading && results.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-i3x-text-muted">
            No objects found matching "{query}"
          </div>
        )}

        {!query && (
          <div className="px-4 py-5 text-sm text-i3x-text-muted text-center">
            Search objects across all tree folders
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-2 border-t border-i3x-border flex items-center justify-between text-xs text-i3x-text-muted">
          <span>
            {results.length > 0 ? `${results.length} result${results.length !== 1 ? 's' : ''}` : ''}
          </span>
          <span className="flex gap-3">
            <span>↑↓ navigate</span>
            <span>↵ select</span>
            <span>Esc close</span>
          </span>
        </div>
      </div>
    </div>
  )
}
