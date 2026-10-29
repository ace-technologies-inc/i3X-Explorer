import { useEffect, useState, type ReactNode } from 'react'
import { CopyButton } from '../details/CopyButton'
import { MaximizeIcon, MinimizeIcon } from '../common/icons'

/**
 * Card, the panel surface every detail section sits on.
 *
 * With `expandable`, the header grows a maximize button and the card can take
 * over the whole window (Esc, or the button again, to come back). That is for
 * the panels whose content is a *drawing*: a relationship map is only as
 * readable as the space it has, and on a laptop the detail area gives it about
 * a third of the screen.
 *
 * Expanding is a **class swap**, not a different element tree: an expandable
 * card always renders the same wrapper, `display: contents` while collapsed (so
 * it adds no box and the card lays out exactly as before) and a fixed overlay
 * while expanded. Toggling therefore keeps every child mounted, so the pan/zoom,
 * the focused branch and the list's expansion survive the trip in both
 * directions, which is the whole point of going full screen mid-investigation.
 * A portal, or conditionally wrapping, would remount the map and throw all of
 * that away on the way in and again on the way out.
 */
export function Card({
  title,
  actions,
  children,
  className = '',
  expandable = false,
}: {
  title?: ReactNode
  /** Right-aligned controls in the card header (toggles, refresh, counts). */
  actions?: ReactNode
  children: ReactNode
  className?: string
  /** Offer a full-window toggle in the header. For drawings, not for text. */
  expandable?: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!expanded) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Esc belongs to whatever is typing or open on top: the search box clears
      // itself with it, a context menu closes with it (and stops propagation
      // before this ever runs). The target is only an Element when something is
      // actually focused; with nothing focused it is the document or the window.
      const target = event.target
      if (
        target instanceof Element &&
        target.closest('input, textarea, select, [role="menu"], [role="dialog"]')
      ) {
        return
      }
      setExpanded(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [expanded])

  const card = (
    <section
      className={`bg-i3x-surface border border-i3x-border rounded-xl p-4 ${className} ${
        expanded ? 'h-full' : ''
      }`}
    >
      {(title || actions || expandable) && (
        <header className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-i3x-text-muted">
            {title}
          </h3>
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
            {actions}
            {expandable && (
              <button
                type="button"
                onClick={() => setExpanded(open => !open)}
                title={expanded ? 'Exit full screen (Esc)' : 'Full screen'}
                aria-label={expanded ? 'Exit full screen' : 'Full screen'}
                aria-pressed={expanded}
                className="w-7 h-7 grid place-items-center rounded-lg border border-i3x-border bg-i3x-bg text-i3x-text-muted hover:text-i3x-text hover:border-i3x-primary transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
              >
                {expanded ? <MinimizeIcon size={14} /> : <MaximizeIcon size={14} />}
              </button>
            )}
          </div>
        </header>
      )}
      {children}
    </section>
  )

  // Plain cards keep their exact old markup: a wrapper would swallow the
  // `space-y` margins their stacked parents apply to `> * + *` (a `contents`
  // box has no margins of its own). `expandable` never changes for a given call
  // site, so this branch is stable and nothing ever remounts across it.
  if (!expandable) return card

  return (
    <div className={expanded ? 'fixed inset-0 z-40 bg-i3x-bg p-3' : 'contents'}>{card}</div>
  )
}

/** Labeled, monospaced, single-line value box. Full text lives in the tooltip. */
export function Field({ label, value }: { label: string; value: string | null | undefined }) {
  const isEmpty = value == null || value === ''
  const shown = isEmpty ? '-' : value

  return (
    <div className="min-w-0">
      <label className="block text-[11.5px] text-i3x-text-muted mb-1.5">{label}</label>
      <div
        title={isEmpty ? undefined : shown}
        className={`flex items-center gap-2 font-mono text-[13px] bg-i3x-bg border border-i3x-border rounded-lg px-3 py-2 ${
          isEmpty ? 'text-i3x-text-muted' : 'text-i3x-text'
        }`}
      >
        <span className="flex-1 min-w-0 truncate">{shown}</span>
        {/* Negative margins keep the box the same height as an empty field. */}
        {!isEmpty && (
          <CopyButton text={shown} title={`Copy ${label}`} className="shrink-0 -my-1 -mr-1.5" />
        )}
      </div>
    </div>
  )
}

/** Pill-style exclusive choice, e.g. Parsed / Raw. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  /** Accessible group name, not rendered. */
  label: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex items-center gap-0.5 bg-i3x-bg border border-i3x-border rounded-lg p-0.5"
    >
      {options.map(option => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`px-3 py-1 text-[11.5px] rounded-md transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary ${
              active
                ? 'bg-i3x-surface text-i3x-primary font-medium shadow-sm'
                : 'text-i3x-text-muted hover:text-i3x-text'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
