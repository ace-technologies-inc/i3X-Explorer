import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * App-wide context menu. Not a library: one fixed-position panel, clamped to
 * the viewport, keyboard-driven (arrows / Enter / Esc), closed by any outside
 * pointer press, window blur, or resize. Entries are plain data so callers
 * (the tree, and later the graphs) build them per right-click.
 */

export interface MenuActionEntry {
  kind: 'action'
  label: string
  /** Right-aligned muted hint: a count, a unit, a shortcut. */
  detail?: string
  icon?: ReactNode
  disabled?: boolean
  onSelect: () => void
}

export type MenuEntry =
  | MenuActionEntry
  | { kind: 'separator' }
  | { kind: 'header'; label: string }

export function ContextMenu({
  x,
  y,
  entries,
  onClose,
}: {
  x: number
  y: number
  entries: MenuEntry[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Rendered hidden for one frame, measured, then clamped into the viewport,
  // so the menu never flickers at an overflowing position.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [activeIdx, setActiveIdx] = useState(-1)

  const actionable = entries
    .map((entry, i) => ({ entry, i }))
    .filter(({ entry }) => entry.kind === 'action' && !entry.disabled)
    .map(({ i }) => i)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    })
  }, [x, y])

  // The menu takes focus so tree keyboard handling (type-ahead, arrows) pauses
  // while it is open; the opener refocuses itself in onClose.
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const run = (index: number) => {
    const entry = entries[index]
    if (entry.kind !== 'action' || entry.disabled) return
    entry.onSelect()
    onClose()
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        onClose()
        break
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault()
        event.stopPropagation()
        if (actionable.length === 0) break
        const dir = event.key === 'ArrowDown' ? 1 : -1
        const cur = actionable.indexOf(activeIdx)
        const next = cur === -1
          ? (dir === 1 ? 0 : actionable.length - 1)
          : (cur + dir + actionable.length) % actionable.length
        setActiveIdx(actionable[next])
        break
      }
      case 'Enter':
        event.preventDefault()
        event.stopPropagation()
        if (activeIdx >= 0) run(activeIdx)
        break
      default:
        // Swallow everything else so keystrokes don't leak into the opener
        // (e.g. the tree's type-ahead).
        event.stopPropagation()
    }
  }

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="menu"
      onKeyDown={handleKeyDown}
      onContextMenu={event => event.preventDefault()}
      style={{
        position: 'fixed',
        left: pos?.x ?? x,
        top: pos?.y ?? y,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className="z-50 min-w-[230px] max-w-[320px] bg-i3x-surface border border-i3x-border rounded-lg shadow-xl py-1 text-sm focus:outline-none"
    >
      {entries.map((entry, i) => {
        if (entry.kind === 'separator') {
          return <div key={i} role="separator" className="my-1 border-t border-i3x-border" />
        }
        if (entry.kind === 'header') {
          return (
            <div key={i} className="px-3 pt-1 pb-1.5 text-[11px] font-semibold text-i3x-text-muted truncate" title={entry.label}>
              {entry.label}
            </div>
          )
        }
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            onMouseEnter={() => setActiveIdx(i)}
            onClick={() => run(i)}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-i3x-text disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none ${
              i === activeIdx ? 'bg-i3x-bg' : ''
            }`}
          >
            <span aria-hidden="true" className="w-4 flex items-center justify-center text-i3x-text-muted flex-shrink-0">
              {entry.icon}
            </span>
            <span className="flex-1 truncate">{entry.label}</span>
            {entry.detail && (
              <span className="text-[11px] text-i3x-text-muted tabular-nums flex-shrink-0">
                {entry.detail}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
