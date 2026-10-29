import { useState } from 'react'
import { Chevron } from '../common/Chevron'
import { JsonViewer } from './JsonViewer'

export interface DataDisclosureSection {
  label: string
  /** Sections with no data (null or undefined) are left out. */
  data: unknown
}

/**
 * The collapsible raw-JSON section at the foot of every detail view
 * (relationships, metadata, the raw entity). A page section of its own, framed
 * like a Card, since it covers the whole payload rather than any one card.
 * `<details>` gives keyboard toggling and expanded-state semantics for free.
 */
export function DataDisclosure({
  title,
  sections,
}: {
  title: string
  sections: DataDisclosureSection[]
}) {
  // Each section serializes its whole payload, so a closed disclosure renders none of them.
  const [open, setOpen] = useState(false)
  return (
    <details
      className="bg-i3x-surface border border-i3x-border rounded-xl group"
      onToggle={event => setOpen(event.currentTarget.open)}
    >
      {/* No `open` prop: inside `<details className="group">` the browser owns the
          state and `group-open:rotate-90` turns the mark. */}
      <summary className="px-4 py-3 flex items-center gap-2 cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-i3x-text-muted hover:text-i3x-text rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary">
        <Chevron />
        {title}
      </summary>

      {open && (
        <div className="border-t border-i3x-border p-4 space-y-3">
          {sections
            .filter(section => section.data != null)
            .map(section => (
              <div key={section.label}>
                <label className="block text-xs text-i3x-text-muted mb-1">{section.label}</label>
                <JsonViewer data={section.data} />
              </div>
            ))}
        </div>
      )}
    </details>
  )
}

/** `metadata` without the keys a detail view already shows elsewhere; null when nothing is left. */
export function metadataExcept(
  metadata: Record<string, unknown> | undefined,
  shownKeys: readonly string[]
): Record<string, unknown> | null {
  if (!metadata) return null
  const rest = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !shownKeys.includes(key))
  )
  return Object.keys(rest).length > 0 ? rest : null
}
