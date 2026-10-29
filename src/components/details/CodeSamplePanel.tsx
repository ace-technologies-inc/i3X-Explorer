import { useState } from 'react'
import type { RequestDescriptor } from '../../api/requestShape'
import { CodeIcon } from '../common/icons'
import { RequestInspectorModal } from './RequestInspectorModal'
import type { RequestInspectorTab, RequestInspectorVariant } from './requestTabs'

/** One selectable request shape behind a single trigger, e.g. a relationship filter. */
export type CodeSampleVariant = RequestInspectorVariant

interface CodeSampleProps {
  /** A single request to show. Ignored when `variants` or `tabs` is given. */
  descriptor?: RequestDescriptor
  /** Two or more request shapes the reader can switch between in the inspector. */
  variants?: CodeSampleVariant[]
  /** Accessible name for the variant picker, e.g. 'Relationship filter'. */
  variantLabel?: string
  /**
   * A full set of request kinds for the inspector's tab bar. When present it
   * supersedes `descriptor`/`variants`; `initialTabId` picks the tab to focus.
   */
  tabs?: RequestInspectorTab[]
  initialTabId?: string
  /** Object / namespace / type name shown in the inspector header. */
  title?: string
  /** Kind label, e.g. 'Object Instance'. */
  subtitle?: string
}

/**
 * The "View request" badge. Clicking it opens the Request Inspector — a large,
 * IDE-style modal — rather than expanding a code block inline. The trigger owns
 * only a boolean; the modal (and all of its language/redaction state) mounts on
 * demand, so the request tooling never re-renders the potentially heavy content
 * it sits beside (the relationship graph, the raw-JSON viewers). The request
 * shapes themselves come straight from the version-accurate descriptors — this
 * change is presentation only.
 */
export function CardCodeSample({
  descriptor,
  variants,
  variantLabel,
  tabs,
  initialTabId,
  title = 'Request',
  subtitle,
}: CodeSampleProps) {
  const [open, setOpen] = useState(false)

  // A single card passes one descriptor or a variant set; the inspector always
  // works in terms of tabs, so wrap the legacy shape into a one-tab set.
  const resolvedTabs: RequestInspectorTab[] =
    tabs ??
    (variants && variants.length > 0
      ? [{ id: 'request', label: 'Request', variants, variantLabel }]
      : descriptor
        ? [{ id: 'request', label: 'Request', descriptor }]
        : [])

  if (resolvedTabs.length === 0) return null

  const initialTab = resolvedTabs.find(tab => tab.id === initialTabId) ?? resolvedTabs[0]
  const preview = initialTab.descriptor ?? initialTab.variants?.[0]?.descriptor

  // A tinted pill meant for a Card header's `actions` slot, so every card's
  // request sits in the same top-right corner. The method is aria-hidden to keep
  // the accessible name "View request"; the tooltip carries method and path.
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={preview ? `${preview.method} ${preview.path}` : undefined}
        className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-i3x-primary/30 bg-i3x-primary/10 px-2.5 py-0.5 text-[11px] font-medium normal-case tracking-normal text-i3x-primary whitespace-nowrap hover:bg-i3x-primary/20 hover:border-i3x-primary/60 transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
      >
        <CodeIcon size={12} />
        View request
        {preview && (
          <span
            aria-hidden="true"
            className="border-l border-i3x-primary/30 pl-1.5 font-mono text-[10px] font-semibold"
          >
            {preview.method}
          </span>
        )}
      </button>
      {open && (
        <RequestInspectorModal
          title={title}
          subtitle={subtitle}
          tabs={resolvedTabs}
          initialTabId={initialTabId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
