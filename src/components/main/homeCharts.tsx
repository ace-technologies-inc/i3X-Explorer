import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * The charts Home is drawn with. The form follows the data's job (the `dataviz`
 * skill's heuristic):
 *
 *   one whole split into parts, at a glance   → SegmentedBar (tall, shares printed on it)
 *   compare parts with each other, or rank    → RankedBars / ObjectBars (one hue, value at the tip)
 *   an ordered distribution                   → ColumnChart
 *   one ratio against its limit               → Meter (the track is a lighter step of the fill)
 *
 * No donuts: arcs compare worse than lengths on a common baseline. Marks are
 * thin, data ends are rounded and baselines square, touching fills are parted by
 * a 2px gap rather than a stroke, and text never wears a series color. Every
 * mark has a `title` (TooltipLayer shows it), and every value a tooltip shows is
 * also printed, so nothing is reachable by hover alone.
 */

/** The one hue for every single-series mark on Home. */
const ACCENT = 'var(--i3x-series-1)'

/** Named parts in a segmented bar before the tail folds into "Other": past six parts it stops reading at a glance. */
const NAMED_PARTS = 5

/** Width of one character of an in-bar label at its 11.5px size, and the padding it needs on both sides. */
const LABEL_CHAR_PX = 7.2
const LABEL_PAD_PX = 16

export interface Part {
  key: string
  label: string
  value: number
  /** The folded tail. It names no single thing, so it has no hue of its own. */
  isOther?: boolean
  /** Drawn like any part, but opens nothing: a part that is not a thing ("at the root"). */
  inert?: boolean
  /** What the folded tail holds, largest first. With these, "Other" can be expanded into a list. */
  members?: Part[]
}

/** The largest parts by name, the rest folded into one that still knows what it holds. Expects the largest first; drops empty parts. */
export function foldParts(parts: Part[], named = NAMED_PARTS): Part[] {
  const present = parts.filter(part => part.value > 0)
  if (present.length <= named + 1) return present
  const tail = present.slice(named)
  return [
    ...present.slice(0, named),
    {
      key: '__other',
      label: `Other (${tail.length.toLocaleString()})`,
      value: tail.reduce((sum, part) => sum + part.value, 0),
      isOther: true,
      members: tail,
    },
  ]
}

/** Slots are assigned in sequence, never skipped or cycled: the order is what keeps neighbors apart for colorblind readers. */
function seriesColor(index: number, isOther = false): { fill: string; ink: string } {
  if (isOther) return { fill: 'rgb(var(--i3x-series-other))', ink: 'rgb(var(--i3x-series-other-ink))' }
  const slot = Math.min(index, NAMED_PARTS) + 1
  return {
    fill: `rgb(var(--i3x-series-${slot}))`,
    // White on every hue but yellow, which is too light for it on the light surface.
    ink: slot === 4 ? 'rgb(var(--i3x-series-4-ink))' : '#ffffff',
  }
}

/** Whole percents, with a decimal only below 1%, where rounding would say "0%" of something that is there. */
function percent(share: number): string {
  const value = share * 100
  if (value >= 1 || value === 0) return `${Math.round(value)}%`
  return `${value.toFixed(1)}%`
}

/** 1,284 stays whole; 35,846 becomes 35.8K: a cap label has a column's width to fit in. */
export function compact(value: number): string {
  if (Math.abs(value) < 10_000) return value.toLocaleString()
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setWidth(element.getBoundingClientRect().width)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary focus-visible:ring-offset-1 focus-visible:ring-offset-i3x-surface'

/** The word that says a folded tail can be opened or closed. Text, not a marker: Home has no icons. */
function ShowHide({ open }: { open: boolean }) {
  return (
    // Hidden from assistive tech: the button's `aria-expanded` already says it.
    <span aria-hidden="true" className="font-medium text-i3x-primary group-hover:underline">
      {open ? 'Hide' : 'Show'}
    </span>
  )
}

/**
 * One whole, split into its parts: each part its own block, its share printed
 * on it where the text fits (measured, never clipped), and a legend that names
 * the parts in block order with the amounts the blocks don't print.
 *
 * A folded "Other" that knows its members opens, from its block or its legend
 * entry, into a list of them under the legend. The list scrolls inside a
 * bounded box, so a tail of a hundred types cannot push the rest of the page
 * away from a bar meant to be read at a glance.
 */
export function SegmentedBar({
  parts,
  unit,
  label,
  onSelect,
}: {
  parts: Part[]
  /** What a part's value counts, for the tooltip: "objects", "instances". */
  unit: string
  /** Accessible name of the whole bar. */
  label: string
  /** When given, a named part opens what it stands for, from its block, its legend entry, or its row under "Other". */
  onSelect?: (key: string) => void
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [otherOpen, setOtherOpen] = useState(false)
  const listId = useId()
  const total = parts.reduce((sum, part) => sum + part.value, 0)
  if (total === 0) return <p className="text-[13px] text-i3x-text-muted">Nothing to show.</p>

  const GAP = 2
  const usable = Math.max(0, width - GAP * (parts.length - 1))
  const expandable = (part: Part) => part.isOther === true && (part.members?.length ?? 0) > 0
  const other = parts.find(expandable)
  const toggleOther = () => setOtherOpen(open => !open)

  return (
    <div>
      <div ref={ref} role="group" aria-label={label} className="flex h-7" style={{ gap: GAP }}>
        {parts.map((part, index) => {
          const share = part.value / total
          const text = percent(share)
          const fits = usable * share >= text.length * LABEL_CHAR_PX + LABEL_PAD_PX
          const color = seriesColor(index, part.isOther)
          const title = `${part.label}: ${part.value.toLocaleString()} ${unit} (${percent(share)})`
          const style = { flex: `${part.value} 1 0%`, background: color.fill, color: color.ink }
          const className = 'min-w-[3px] h-full rounded-[4px] flex items-center px-2 text-[11.5px] font-medium leading-none whitespace-nowrap'
          const lift = `hover:brightness-110 transition-[filter] motion-reduce:transition-none ${FOCUS}`

          if (expandable(part)) {
            return (
              <button
                key={part.key}
                type="button"
                title={`${title} · click to ${otherOpen ? 'hide' : 'list'} them`}
                aria-label={title}
                aria-expanded={otherOpen}
                aria-controls={listId}
                onClick={toggleOther}
                style={style}
                className={`${className} ${lift}`}
              >
                {fits && text}
              </button>
            )
          }
          return onSelect && !part.isOther && !part.inert ? (
            <button
              key={part.key}
              type="button"
              title={title}
              aria-label={title}
              onClick={() => onSelect(part.key)}
              style={style}
              className={`${className} ${lift}`}
            >
              {fits && text}
            </button>
          ) : (
            <span key={part.key} role="img" title={title} aria-label={title} style={style} className={className}>
              {fits && text}
            </span>
          )
        })}
      </div>

      <ul className="mt-3.5 flex flex-wrap gap-x-5 gap-y-1.5">
        {parts.map((part, index) => {
          const entry = (
            <>
              <span
                aria-hidden="true"
                className="shrink-0 w-2.5 h-2.5 rounded-[3px]"
                style={{ background: seriesColor(index, part.isOther).fill }}
              />
              <span className="truncate text-i3x-text group-hover:text-i3x-primary">{part.label}</span>
              <span className="text-i3x-text-muted tabular-nums">{part.value.toLocaleString()}</span>
            </>
          )
          const button = `group max-w-full inline-flex items-center gap-2 rounded ${FOCUS}`
          return (
            <li key={part.key} className="min-w-0 text-[12.5px]">
              {expandable(part) ? (
                <button type="button" aria-expanded={otherOpen} aria-controls={listId} onClick={toggleOther} className={button}>
                  {entry}
                  <ShowHide open={otherOpen} />
                </button>
              ) : onSelect && !part.isOther && !part.inert ? (
                <button type="button" onClick={() => onSelect(part.key)} className={button}>
                  {entry}
                </button>
              ) : (
                <span className="max-w-full inline-flex items-center gap-2">{entry}</span>
              )}
            </li>
          )
        })}
      </ul>

      {other && otherOpen && (
        <div id={listId} className="mt-4 pt-3 border-t border-i3x-border max-h-72 overflow-y-auto pr-2">
          <RankedBars
            rows={other.members!.map(member => ({ key: member.key, label: member.label, value: member.value, inert: member.inert }))}
            unit={unit}
            total={total}
            onSelect={onSelect}
            muted
          />
        </div>
      )}
    </div>
  )
}

export interface BarRow {
  key: string
  label: string
  /** Muted text after the label: what kind of thing it is, where it sits. */
  note?: string
  value: number
  isOther?: boolean
  /** Drawn like any row, but opens nothing: a bucket that is not a thing ("at the root"). */
  inert?: boolean
  /** What a folded "Other" row holds, largest first. With these, the row opens into them. */
  members?: BarRow[]
  /** Full text for the tooltip, when the label alone could be mistaken for another row. */
  title?: string
}

/**
 * The first `limit` rows by name, the rest folded into one "Other (N)" row that
 * opens into them. Expects the largest first. A tail of one is shown as itself:
 * an "Other (1)" row would hide a name to save nothing.
 */
export function foldRows(rows: BarRow[], limit: number): BarRow[] {
  if (rows.length <= limit + 1) return rows
  const tail = rows.slice(limit)
  return [
    ...rows.slice(0, limit),
    {
      key: '__other',
      label: `Other (${tail.length.toLocaleString()})`,
      value: tail.reduce((sum, row) => sum + row.value, 0),
      isOther: true,
      members: tail,
    },
  ]
}

/**
 * One thin bar on a square baseline, for a row that draws its own size inside a
 * column of its own: `share` is its length against the longest in that column.
 */
export function DataBar({ share, muted = false }: { share: number; muted?: boolean }) {
  return (
    <span className="block">
      <span
        className="block h-2 rounded-r-[4px]"
        style={{
          width: `max(2px, ${Math.min(1, Math.max(0, share)) * 100}%)`,
          background: muted ? 'rgb(var(--i3x-series-other))' : `rgb(${ACCENT})`,
        }}
      />
    </span>
  )
}

function barWidth(ratio: number, reserve: string): string {
  // The longest bar stops short of the edge, so its own value still fits at its tip.
  return `max(2px, calc((100% - ${reserve}) * ${ratio}))`
}

function rowTitle(row: BarRow, unit: string, total: number | undefined, opens: boolean): string {
  const share = total ? ` (${percent(row.value / total)})` : ''
  return `${row.title ?? row.label}: ${row.value.toLocaleString()} ${unit}${share}${opens ? ' · click to open' : ''}`
}

/**
 * Parts compared with each other: one bar a row, largest first, one hue (a
 * darker-where-bigger ramp would only say again what the length already says),
 * the value at the tip. The bars lead; the label column is narrow.
 *
 * A folded "Other" row that knows its members is replaced by them when it is
 * opened: the sum goes away once its parts are listed, since showing both draws
 * the same objects twice. "Show fewer" after the last row folds them back.
 */
export function RankedBars({
  rows,
  unit,
  total,
  onSelect,
  muted = false,
}: {
  rows: BarRow[]
  unit: string
  /** The whole the rows are part of, to put each one's share in its tooltip. */
  total?: number
  onSelect?: (key: string) => void
  /** Draw every bar in the "Other" gray: for the list a segmented bar's gray block opens into. */
  muted?: boolean
}) {
  const [otherOpen, setOtherOpen] = useState(false)
  const otherRef = useRef<HTMLButtonElement>(null)
  const firstMemberRef = useRef<HTMLButtonElement>(null)
  const fewerRef = useRef<HTMLButtonElement>(null)
  const carryFocus = useRef(false)

  // The button that was pressed is replaced by other rows. From the keyboard,
  // focus has to follow to what replaced it, or it is dropped back to the page.
  useEffect(() => {
    if (!carryFocus.current) return
    carryFocus.current = false
    const target = otherOpen ? firstMemberRef.current ?? fewerRef.current : otherRef.current
    target?.focus({ preventScroll: true })
  }, [otherOpen])

  const folded = (row: BarRow) => row.isOther === true && (row.members?.length ?? 0) > 0
  // The scale is set by what is drawn: once "Other" is opened its sum is gone, and must not go on dwarfing every bar.
  const drawn = otherOpen ? rows.flatMap(row => (folded(row) ? row.members! : [row])) : rows
  const peak = drawn.reduce((max, row) => Math.max(max, row.value), 0)
  if (peak === 0) return <p className="text-[13px] text-i3x-text-muted">Nothing to count.</p>

  const toggleOther = (event: React.MouseEvent) => {
    // A click with no pointer behind it (detail 0) came from Enter or Space.
    carryFocus.current = event.detail === 0
    setOtherOpen(open => !open)
  }

  const bar = (row: BarRow, options: { reserve: string; highlight?: boolean; tail?: ReactNode }) => (
    <span className="grid grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)] items-center gap-x-3 py-[5px]">
      <span className={`text-[13px] text-i3x-text truncate text-left ${options.highlight ? 'group-hover:text-i3x-primary' : ''}`}>
        {row.label}
      </span>
      <span className="flex items-center gap-2 min-w-0">
        <span
          className="shrink-0 h-2.5 rounded-r-[4px]"
          style={{
            width: barWidth(row.value / peak, options.reserve),
            background: row.isOther || muted ? 'rgb(var(--i3x-series-other))' : `rgb(${ACCENT})`,
          }}
        />
        <span className="text-[12.5px] text-i3x-text-muted tabular-nums">{row.value.toLocaleString()}</span>
        {options.tail}
      </span>
    </span>
  )

  const item = (row: BarRow, ref?: React.Ref<HTMLButtonElement>) => {
    const opens = onSelect !== undefined && !row.isOther && !row.inert
    const title = rowTitle(row, unit, total, opens)
    return (
      <li key={row.key}>
        {opens ? (
          <button ref={ref} type="button" onClick={() => onSelect!(row.key)} title={title} className={`group block w-full rounded ${FOCUS}`}>
            {bar(row, { reserve: '4.25rem', highlight: true })}
          </button>
        ) : (
          <span className="block" title={title}>
            {bar(row, { reserve: '4.25rem' })}
          </span>
        )}
      </li>
    )
  }

  return (
    <ul>
      {rows.flatMap(row => {
        if (!folded(row)) return [item(row)]
        const members = row.members!

        if (!otherOpen) {
          return [
            <li key={row.key}>
              <button
                ref={otherRef}
                type="button"
                aria-expanded={false}
                onClick={toggleOther}
                title={`${rowTitle(row, unit, total, false)} · click to list them`}
                className={`group block w-full rounded ${FOCUS}`}
              >
                {/* A wider reserve than the other rows: this one's tip carries "Show" as well as its value. */}
                {bar(row, { reserve: '7.25rem', tail: <span className="text-[12.5px]"><ShowHide open={false} /></span> })}
              </button>
            </li>,
          ]
        }

        return [
          ...members.map((member, index) => item(member, index === 0 ? firstMemberRef : undefined)),
          <li key="__fewer">
            <button
              ref={fewerRef}
              type="button"
              aria-expanded
              onClick={toggleOther}
              className={`py-[5px] text-[12.5px] font-medium text-i3x-primary rounded hover:underline ${FOCUS}`}
            >
              Show fewer
            </button>
          </li>,
        ]
      })}
    </ul>
  )
}

/**
 * A list of objects with their sizes drawn: the name leads (it is what you
 * came to click), and a short bar in its own column lets the rows be compared
 * without reading the figures.
 */
export function ObjectBars({
  rows,
  unit,
  onSelect,
}: {
  rows: BarRow[]
  unit: string
  onSelect: (key: string) => void
}) {
  const peak = rows.reduce((max, row) => Math.max(max, row.value), 0)

  return (
    <ul>
      {rows.map(row => (
        <li key={row.key} className="border-t border-i3x-border/60 first:border-t-0">
          <ObjectBar row={row} peak={peak} unit={unit} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  )
}

/** Height of one `ObjectBar`, for a list that windows them. */
export const OBJECT_BAR_HEIGHT = 36

/** One row of `ObjectBars`, on its own for a list too long to mount whole: `peak` is the largest value in that list. */
export function ObjectBar({
  row,
  peak,
  unit,
  onSelect,
}: {
  row: BarRow
  peak: number
  unit: string
  onSelect: (key: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(row.key)}
      title={rowTitle(row, unit, undefined, true)}
      className={`group w-full grid grid-cols-[minmax(0,1fr)_minmax(3rem,7rem)_3.25rem] items-center gap-x-3 py-2 text-left rounded ${FOCUS}`}
    >
      <span className="min-w-0 flex items-baseline gap-2">
        <span className="text-[13px] text-i3x-text truncate group-hover:text-i3x-primary">{row.label}</span>
        {row.note && <span className="min-w-0 flex-1 text-[12px] text-i3x-text-muted truncate">{row.note}</span>}
      </span>
      <span className="block">
        <span
          className="block h-2 rounded-r-[4px]"
          style={{ width: peak > 0 ? barWidth(row.value / peak, '0px') : '2px', background: `rgb(${ACCENT})` }}
        />
      </span>
      <span className="text-[12.5px] text-i3x-text tabular-nums text-right">{row.value.toLocaleString()}</span>
    </button>
  )
}

/** Past this many columns the caps crowd, so only the tallest keeps its figure; the rest stay in their tooltips and the list beside the chart. */
const LABEL_EVERY_CAP_UP_TO = 9

/**
 * An ordered distribution: one thin column per step, on one baseline, the
 * figure on the cap. For the hierarchy, where the order of the levels is the
 * point and the shape (wide at the bottom, or not) is what you read off it.
 */
export function ColumnChart({
  columns,
  unit,
  label,
}: {
  /** `label` names the column in its tooltip ("Level 2"); `tick` is what fits under it ("2"). */
  columns: { key: string; label: string; tick?: string; value: number }[]
  unit: string
  label: string
}) {
  const peak = columns.reduce((max, column) => Math.max(max, column.value), 0)
  if (peak === 0) return <p className="text-[13px] text-i3x-text-muted">Nothing to count.</p>
  const labelAll = columns.length <= LABEL_EVERY_CAP_UP_TO

  return (
    <div role="img" aria-label={label}>
      <div className="flex items-end gap-1.5 h-36 border-b border-i3x-border">
        {columns.map(column => (
          <div
            key={column.key}
            title={`${column.label}: ${column.value.toLocaleString()} ${unit}`}
            // The top padding is the room the tallest column's figure needs above its cap.
            className="flex-1 min-w-0 h-full pt-5 flex items-end justify-center"
          >
            <div
              className="relative w-full max-w-[24px] rounded-t-[4px]"
              style={{ height: `max(2px, ${(column.value / peak) * 100}%)`, background: `rgb(${ACCENT})` }}
            >
              {(labelAll || column.value === peak) && (
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 text-[11.5px] leading-none text-i3x-text-muted tabular-nums whitespace-nowrap">
                  {compact(column.value)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1.5">
        {columns.map(column => (
          <div key={column.key} className="flex-1 min-w-0 text-center text-[11.5px] text-i3x-text-muted truncate">
            {column.tick ?? column.label}
          </div>
        ))}
      </div>
    </div>
  )
}

/** One ratio against its limit. The track is the fill's own color, lighter, so the two read as one bar. */
export function Meter({
  value,
  max,
  label,
  className = '',
}: {
  value: number
  max: number
  /** Accessible sentence: what is measured, and the figures. */
  label: string
  className?: string
}) {
  const share = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`block h-2 rounded-full overflow-hidden ${className}`}
      style={{ background: `rgb(${ACCENT} / 0.2)` }}
    >
      <span className="block h-full rounded-full" style={{ width: `${Math.max(share * 100, share > 0 ? 2 : 0)}%`, background: `rgb(${ACCENT})` }} />
    </span>
  )
}
