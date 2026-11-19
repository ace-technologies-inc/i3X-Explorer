import { useRef, type ReactNode } from 'react'

/**
 * The layout pieces of Home and of the Model insights page: cards on the app's
 * page color. The charts that go in them are in `homeCharts.tsx`.
 *
 * Two rules. No icons. And no decoration: nothing is drawn unless it carries
 * information (no halos, badges or tinted backdrops, no subtitle that only
 * restates its title).
 */

/** The surface every card shares. */
const CARD = 'bg-i3x-surface border border-i3x-border rounded-xl'

/**
 * The scrolling page a Home tab sits on: a column of rows, each a card or a
 * grid of cards.
 *
 * `relative` is deliberate. Screen-reader-only text is absolutely positioned,
 * and inside a scroll container that is not itself positioned it is laid out
 * against the window instead: a label far down a long tab then stretches the
 * document past the viewport, and the whole app (toolbar included) can be
 * scrolled out of place.
 */
export function HomePage({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex-1 min-h-0 overflow-y-auto bg-i3x-bg">
      <div className="w-full max-w-[1600px] px-3 sm:px-5 py-4 space-y-4">{children}</div>
    </div>
  )
}

/**
 * A titled card. The title says plainly what is in it ("Objects by type", not a
 * phrase about it); the note is for a fact the title can't carry (how many,
 * which of how many) and is left out when there is none.
 */
export function Panel({
  title,
  note,
  action,
  children,
  className = '',
}: {
  title: ReactNode
  /** One muted line under the title, only when it adds a fact. */
  note?: ReactNode
  /** Right-aligned in the header: a link to the rest. */
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`${CARD} p-5 min-w-0 ${className}`}>
      <header className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-i3x-text">{title}</h3>
          {note && <p className="mt-0.5 text-[12.5px] text-i3x-text-muted">{note}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      {children}
    </section>
  )
}

/**
 * One headline number in its own card: what it counts, the value, then a line
 * of context. Proportional figures on purpose: tabular digits make a large
 * standalone number look loose.
 */
export function Kpi({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className={`${CARD} px-5 py-4 min-w-0`}>
      <div className="text-[12.5px] text-i3x-text-muted">{label}</div>
      {/* Not leading-none: truncate clips at the line box, and a tight one cuts the tail off a "g". */}
      <div className="mt-1.5 text-[28px] leading-[1.2] font-semibold tracking-tight text-i3x-text truncate">{value}</div>
      {note && <div className="mt-1.5 text-[12.5px] leading-snug text-i3x-text-muted">{note}</div>}
    </div>
  )
}

/** A smaller figure inside a card: the value, then what it counts. */
export function MiniFigure({ value, label, note }: { value: ReactNode; label: string; note?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[20px] leading-tight font-semibold tracking-tight text-i3x-text">{value}</div>
      <div className="mt-0.5 text-[12.5px] text-i3x-text-muted">{label}</div>
      {note && <div className="mt-0.5 text-[12px] text-i3x-text-muted">{note}</div>}
    </div>
  )
}

/**
 * The tab strip Home and Model insights share. Arrow keys, Home and End move
 * between tabs; the panel it controls is `${idPrefix}-panel-${id}`.
 */
export function TabStrip<T extends string>({
  tabs,
  active,
  onChange,
  label,
  idPrefix,
  className = '',
}: {
  /** `count` is printed muted beside the label: how many things the tab holds. */
  tabs: { id: T; label: string; count?: number }[]
  active: T
  onChange: (tab: T) => void
  /** Accessible name of the tab list. */
  label: string
  idPrefix: string
  className?: string
}) {
  const refs = useRef(new Map<T, HTMLButtonElement | null>())

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const current = tabs.findIndex(tab => tab.id === active)
    let next: number | null = null
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    if (next === null) return
    event.preventDefault()
    onChange(tabs[next].id)
    refs.current.get(tabs[next].id)?.focus()
  }

  return (
    <div role="tablist" aria-label={label} onKeyDown={handleKeyDown} className={`flex gap-1 overflow-x-auto ${className}`}>
      {tabs.map(tab => {
        const selected = tab.id === active
        return (
          <button
            key={tab.id}
            ref={element => { refs.current.set(tab.id, element) }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={`px-3 sm:px-4 py-2.5 text-[13.5px] whitespace-nowrap border-b-2 -mb-px transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary focus-visible:rounded-t ${
              selected
                ? 'text-i3x-primary border-i3x-primary font-medium'
                : 'text-i3x-text-muted border-transparent hover:text-i3x-text'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="ml-1.5 text-[12px] font-normal text-i3x-text-muted tabular-nums">{tab.count.toLocaleString()}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** "Show" / "Hide": what opens or closes says so in a word, since these pages use no icons. */
export function Toggle({
  open,
  onToggle,
  label,
  children,
}: {
  open: boolean
  onToggle: () => void
  /** Accessible name: what is shown or hidden ("exceptions to Station sits under a Line"). */
  label: string
  /** Printed before the word, as part of the same button: the count it opens. */
  children?: ReactNode
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} ${label}`}
      onClick={onToggle}
      className="group inline-flex items-baseline gap-2 text-[12.5px] whitespace-nowrap rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
    >
      {children}
      <span className="font-medium text-i3x-primary group-hover:underline">{open ? 'Hide' : 'Show'}</span>
    </button>
  )
}

/** A text action: reads as a link, behaves as a button. */
export function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[13px] font-medium text-i3x-primary whitespace-nowrap rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
    >
      {children}
    </button>
  )
}

/** A sentence that reports a failure, announced when it appears. The dot stays on the first line however far the text wraps. */
export function ErrorNotice({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p role="alert" className={`flex items-start gap-2.5 text-[13px] leading-relaxed text-i3x-text break-words ${className}`}>
      <span aria-hidden="true" className="shrink-0 mt-[7px] w-1.5 h-1.5 rounded-full bg-i3x-error" />
      <span className="min-w-0">{children}</span>
    </p>
  )
}
