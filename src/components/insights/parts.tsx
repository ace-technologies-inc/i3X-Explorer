import { useState } from 'react'
import { useExplorerStore } from '../../stores/explorer'
import { useElementNavigation } from '../main/navigation'
import { WindowedList } from './WindowedList'
import type { InsightRef } from '../main/insightsReport'

/** Small pieces every view of the Model insights tab uses. */

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary'
const LINK = `font-medium text-i3x-primary whitespace-nowrap rounded hover:underline ${FOCUS}`

/** 99.4% stays 99.4%: near a convention's threshold the decimal is the whole story. */
export function formatShare(share: number): string {
  const value = share * 100
  if (value >= 99.95) return '100%'
  if (value >= 99 || value < 1) return `${value.toFixed(1)}%`
  return `${Math.round(value)}%`
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Where an object sits, from an InsightRef's context: "in Line 4", "at the root". */
export function contextPhrase(context: string): string {
  if (context === '(at root)') return 'at the root'
  if (context === '(parent not in catalog)') return 'under a parent the catalog does not hold'
  return `in ${context}`
}

/**
 * A type's name. Opens the type when the server declares it; an instance's
 * typeId is not guaranteed to be declared, and a button that does nothing is
 * worse than plain text.
 */
export function TypeName({ typeId, label, className = '' }: { typeId: string | null; label: string; className?: string }) {
  const { selectType } = useElementNavigation()
  const declared = useExplorerStore(state => typeId !== null && state.typeIndex.has(typeId))
  if (!declared || typeId === null) {
    return (
      <span className={`truncate ${className}`} title={typeId ? `${typeId} · not declared by the server` : undefined}>
        {label}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={() => selectType(typeId)}
      title={`${typeId} · open this type`}
      className={`truncate text-left rounded hover:text-i3x-primary ${FOCUS} ${className}`}
    >
      {label}
    </button>
  )
}

/** One object, as a way to it: its name, and where it sits (names repeat; name and place together do not). */
function RefRow({ item }: { item: InsightRef }) {
  const { selectElement } = useElementNavigation()
  return (
    <button
      type="button"
      onClick={() => selectElement(item.elementId)}
      title={`${item.elementId} · click to open`}
      className={`group w-full h-7 flex items-baseline gap-2.5 text-left rounded min-w-0 ${FOCUS}`}
    >
      <span className="text-[13px] text-i3x-text truncate group-hover:text-i3x-primary">{item.label}</span>
      <span className="text-[12px] text-i3x-text-muted truncate">{contextPhrase(item.context)}</span>
    </button>
  )
}

// Module-level, so the virtualizer is not handed a new key function (and re-measures every row) on each render.
const refKey = (item: InsightRef) => item.elementId
const renderRef = (item: InsightRef) => <RefRow item={item} />

/** Every object of a list, windowed: a list of exceptions or orphans can be thousands long. */
export function RefList({ items, className = 'max-h-56' }: { items: InsightRef[]; className?: string }) {
  return <WindowedList items={items} estimateHeight={28} className={className} getKey={refKey} renderRow={renderRef} />
}

/** A few objects named in a line, each a way to it. */
export function ExampleLinks({ items }: { items: InsightRef[] }) {
  const { selectElement } = useElementNavigation()
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1 min-w-0">
      {items.map(item => (
        <button
          key={item.elementId}
          type="button"
          onClick={() => selectElement(item.elementId)}
          title={`${item.elementId} · ${contextPhrase(item.context)} · click to open`}
          className={`max-w-[16rem] truncate text-[13px] text-i3x-primary rounded hover:underline ${FOCUS}`}
        >
          {item.label}
        </button>
      ))}
    </span>
  )
}

/** Copies a payload built on click, never on render: a finding's member list can be thousands long. */
export function CopyLink({ build, children }: { build: () => string; children: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(build())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable (insecure context): fail quietly, as the app's other copy buttons do.
    }
  }
  return (
    <button type="button" onClick={() => void copy()} className={`text-[12.5px] ${LINK}`}>
      {copied ? 'Copied' : children}
    </button>
  )
}

/** `ShowMore` as the last row of a divided list: the same rule above it as between the rows. */
export const ROWS_FOOTER = 'pt-2.5 border-t border-i3x-border/60'

export interface Paged<T> {
  shown: T[]
  hidden: number
  step: number
  showMore: () => void
  showAll: () => void
}

/**
 * The first page of a list, and a way to all of the rest. Paging, not a
 * scrolling box: the page already scrolls, and a second scrollbar inside a card
 * is clutter. A new list starts from its first page again.
 */
export function usePaged<T>(items: T[], pageSize: number): Paged<T> {
  const [state, setState] = useState({ items, limit: pageSize })
  // Reset during render, not in an effect: an effect would paint the old limit over the new list first.
  const limit = state.items === items ? state.limit : pageSize
  if (state.items !== items) setState({ items, limit: pageSize })

  const shown = items.slice(0, limit)
  return {
    shown,
    hidden: items.length - shown.length,
    step: pageSize,
    showMore: () => setState({ items, limit: limit + pageSize }),
    showAll: () => setState({ items, limit: items.length }),
  }
}

/**
 * What a paged list still holds, and the two ways to it. Never a bare "and 12
 * more": a count nobody can open is a dead end.
 */
export function ShowMore<T>({
  paged,
  noun,
  className = 'mt-3',
}: {
  paged: Paged<T>
  /** What the list holds, plural: "types", "conventions with exceptions". */
  noun: string
  /** Spacing above it. Under a divided list, pass `ROWS_FOOTER` so it reads as the list's last row. */
  className?: string
}) {
  const { hidden, step } = paged
  if (hidden <= 0) return null
  const next = Math.min(step, hidden)
  return (
    <div className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12.5px] ${className}`}>
      <span className="text-i3x-text-muted tabular-nums">
        {hidden.toLocaleString()} more {noun}
      </span>
      <button type="button" onClick={paged.showMore} className={LINK}>
        {next === hidden ? 'Show them' : `Show ${next.toLocaleString()} more`}
      </button>
      {hidden > next && (
        <button type="button" onClick={paged.showAll} className={LINK}>
          Show all
        </button>
      )}
    </div>
  )
}

/**
 * The first few names of a list in a line, and a button for the rest. The
 * button opens the place where all of them are listed, so the count is a door
 * and not "and 3 others".
 */
export function NameLine({
  names,
  max,
  onMore,
  moreLabel,
}: {
  names: React.ReactNode[]
  /** Names printed before the rest is counted. */
  max: number
  onMore: () => void
  /** Accessible name of the button: what the rest is, and where it opens. */
  moreLabel: string
}) {
  const rest = names.length - max
  return (
    <span className="flex items-baseline gap-x-2 min-w-0 text-[12.5px]">
      <span className="min-w-0 truncate">
        {names.slice(0, max).map((name, index) => (
          <span key={index}>
            {index > 0 && <span className="text-i3x-text-muted"> · </span>}
            {name}
          </span>
        ))}
      </span>
      {rest > 0 && (
        <button type="button" onClick={onMore} aria-label={moreLabel} title={moreLabel} className={`shrink-0 ${LINK}`}>
          {rest.toLocaleString()} more
        </button>
      )}
    </span>
  )
}
