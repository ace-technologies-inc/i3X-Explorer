import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useShallow } from 'zustand/react/shallow'
import { useDiffStore } from '../../stores/diff'
import { useExplorerStore } from '../../stores/explorer'
import { useConnectionStore } from '../../stores/connection'
import { useElementNavigation } from '../main/navigation'
import { InfoHint } from '../main/InfoHint'
import { Card, SegmentedControl } from '../main/primitives'
import { Spinner } from '../common/Spinner'
import { CopyJsonButton } from '../common/CopyJsonButton'
import { CloseIcon, RefreshIcon, CheckIcon } from '../common/icons'
import type { CatalogDiff, ObjectChange, FieldDelta, ChangedSubtree } from './diffEngine'
import type { Snapshot } from './snapshot'
import type { ObjectInstance } from '../../api/types'

/**
 * The diff between a loaded baseline snapshot and the current catalog (live,
 * or a second snapshot). A main-panel state alongside Home and element detail:
 * any navigation, a diff row, the tree, search, Back, leaves this view (the
 * store closes it on selection change), and the toolbar reopens it instantly
 * because the baseline and result stay loaded.
 *
 * Rows resolve display data through the live objectIndex / the baseline's own
 * map at render time, the diff result itself holds only elementIds and field
 * deltas. Every category list is virtualized: a catalog diff can legitimately
 * hold 50k added rows, and windowing is the same answer here as in the tree.
 */

type CategoryKey =
  | 'added'
  | 'removed'
  | 'reparented'
  | 'retyped'
  | 'renamed'
  | 'movedNamespace'
  | 'metadataOnly'

const CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: 'added', label: 'Added' },
  { key: 'removed', label: 'Removed' },
  { key: 'reparented', label: 'Re-parented' },
  { key: 'retyped', label: 'Re-typed' },
  { key: 'renamed', label: 'Renamed' },
  { key: 'movedNamespace', label: 'Moved namespace' },
  { key: 'metadataOnly', label: 'Metadata' },
]

const ROW_HEIGHT = 52

function categoryItems(diff: CatalogDiff, key: CategoryKey): string[] | ObjectChange[] {
  return diff[key]
}

function categoryCount(diff: CatalogDiff, key: CategoryKey): number {
  return diff[key].length
}

export function DiffView() {
  const {
    baseline,
    baselineIndex,
    baselineWarnings,
    comparison,
    comparisonIndex,
    comparisonWarnings,
    diff,
    subtrees,
    diffedAt,
    busy,
    error,
    deepCompare,
    runDiff,
    setDeepCompare,
    closeView,
    clearError,
  } = useDiffStore(
    useShallow(s => ({
      baseline: s.baseline,
      baselineIndex: s.baselineIndex,
      baselineWarnings: s.baselineWarnings,
      comparison: s.comparison,
      comparisonIndex: s.comparisonIndex,
      comparisonWarnings: s.comparisonWarnings,
      diff: s.diff,
      subtrees: s.subtrees,
      diffedAt: s.diffedAt,
      busy: s.busy,
      error: s.error,
      deepCompare: s.deepCompare,
      runDiff: s.runDiff,
      setDeepCompare: s.setDeepCompare,
      closeView: s.closeView,
      clearError: s.clearError,
    }))
  )

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-i3x-bg">
      <header className="px-3 sm:px-5 py-4 bg-i3x-surface border-b border-i3x-border flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-i3x-text flex items-center gap-2">
            Snapshot diff
            <InfoHint label="How this diff works" title="How this diff works">
              Objects are matched by <span className="font-mono">elementId</span>. In both catalogs
              means the same object, so its fields get compared. Only in the baseline means removed,
              only in the current one means added. The categories are counted separately, so one
              object that moved <i>and</i> changed type shows up in both lists.
              <br />
              <br />
              A loaded baseline is a second full catalog held in memory. Clear it from the Snapshot
              menu when you are done with it.
            </InfoHint>
          </h1>
          <p className="text-xs text-i3x-text-muted mt-1">
            What changed between the baseline snapshot and the {comparison ? 'comparison snapshot' : 'live catalog'}.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <SegmentedControl
            label="Comparison depth"
            value={deepCompare ? 'deep' : 'fields'}
            options={[
              { value: 'fields', label: 'Fields' },
              { value: 'deep', label: 'Fields + metadata' },
            ]}
            onChange={value => setDeepCompare(value === 'deep')}
          />
          <InfoHint label="What does metadata compare cost?" title="Fields + metadata">
            Fields compares parent, type, name and namespace, which takes about 50ms over 100,000
            objects. Adding metadata also compares each object's{' '}
            <span className="font-mono">metadata</span> and{' '}
            <span className="font-mono">schemaExtensions</span>, which took about 200ms in the same
            test and grows with how big those payloads are. Against the live catalog it first
            downloads every object's metadata, which the catalog is loaded without. That is why it
            is optional. Objects under <b className="text-i3x-text">Metadata</b> changed <i>only</i> there.
          </InfoHint>
          <button
            onClick={runDiff}
            disabled={!baseline || busy !== null}
            title={comparison ? 'Re-run the diff' : 'Re-run the diff against the catalog as it is now'}
            aria-label="Re-run diff"
            className="p-1.5 rounded text-i3x-text-muted hover:text-i3x-text hover:bg-i3x-bg transition-colors motion-reduce:transition-none disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <RefreshIcon size={15} />
          </button>
          <button
            onClick={closeView}
            title="Close the diff view"
            aria-label="Close the diff view"
            className="p-1.5 rounded text-i3x-text-muted hover:text-i3x-text hover:bg-i3x-bg transition-colors motion-reduce:transition-none"
          >
            <CloseIcon size={15} />
          </button>
        </div>
      </header>

      {error && (
        <div className="mx-3 sm:mx-5 mt-3 flex items-start justify-between gap-3 bg-i3x-error/10 border border-i3x-error/40 rounded-xl px-4 py-2.5">
          <p className="text-[12.5px] text-i3x-text">
            <b className="text-i3x-error">Snapshot problem:</b> {error}
          </p>
          <button
            onClick={clearError}
            aria-label="Dismiss error"
            className="text-i3x-text-muted hover:text-i3x-text rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
          >
            <CloseIcon size={13} />
          </button>
        </div>
      )}

      {busy === 'reading' ? (
        <CenterNote>
          <Spinner size={16} className="text-i3x-primary" />
          Reading snapshot…
        </CenterNote>
      ) : !baseline ? (
        <CenterNote>
          <span className="text-i3x-text-muted">
            No baseline loaded. Use the Snapshot menu in the toolbar to load one.
          </span>
        </CenterNote>
      ) : (
        <>
          <ProvenanceBanner
            baseline={baseline}
            comparison={comparison}
            diff={diff}
            diffedAt={diffedAt}
            warnings={[...baselineWarnings, ...comparisonWarnings]}
          />
          {busy === 'diffing' || !diff ? (
            <CenterNote>
              <Spinner size={16} className="text-i3x-primary" />
              Computing diff…
            </CenterNote>
          ) : diff.identical ? (
            <CenterNote>
              <div className="text-center">
                <p className="text-sm text-i3x-text flex items-center justify-center gap-2">
                  <CheckIcon size={15} className="text-i3x-success" />
                  No differences
                </p>
                <p className="text-xs text-i3x-text-muted mt-1.5 max-w-md">
                  {diff.currentCount.toLocaleString()} objects, plus types and namespaces, compared{' '}
                  {diff.deepCompared
                    ? 'including metadata payloads.'
                    : 'by parent, type, name and namespace. Metadata was not compared, switch to "Fields + metadata" to include it.'}
                </p>
              </div>
            </CenterNote>
          ) : (
            <DiffBody
              diff={diff}
              subtrees={subtrees}
              baseline={baseline}
              baselineIndex={baselineIndex}
              comparisonIndex={comparisonIndex}
            />
          )}
        </>
      )}
    </div>
  )
}

function CenterNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 grid place-items-center p-6">
      <div className="flex items-center gap-2 text-sm text-i3x-text">{children}</div>
    </div>
  )
}

/** Which server and moment each side of the diff came from. Never assume same server. */
function ProvenanceBanner({
  baseline,
  comparison,
  diff,
  diffedAt,
  warnings,
}: {
  baseline: Snapshot
  comparison: Snapshot | null
  diff: CatalogDiff | null
  diffedAt: string | null
  warnings: string[]
}) {
  const liveServerUrl = useConnectionStore(s => s.serverUrl)
  const rightUrl = comparison ? comparison.serverUrl : liveServerUrl
  const crossServer = baseline.serverUrl !== '' && rightUrl !== '' && baseline.serverUrl !== rightUrl

  const notes: string[] = [...warnings]
  if (crossServer) {
    notes.push('The two sides come from different servers, this is an environment comparison.')
  }
  if (diff && diff.duplicates.baseline > 0) {
    notes.push(
      `${diff.duplicates.baseline.toLocaleString()} duplicate elementIds in the baseline (last entry wins).`
    )
  }
  if (diff && diff.duplicates.current > 0) {
    notes.push(
      `${diff.duplicates.current.toLocaleString()} duplicate elementIds in the current catalog (last entry wins).`
    )
  }

  return (
    <div className="px-3 sm:px-5 pt-3 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <ProvenanceSide
          label="Baseline snapshot"
          serverUrl={baseline.serverUrl || '(unknown server)'}
          when={baseline.capturedAt ? `captured ${formatTime(baseline.capturedAt)}` : 'capture time unknown'}
          objects={diff?.baselineCount ?? baseline.counts.objects}
        />
        <ProvenanceSide
          label={comparison ? 'Comparison snapshot' : 'Live catalog'}
          serverUrl={rightUrl || '(unknown server)'}
          when={
            comparison
              ? comparison.capturedAt
                ? `captured ${formatTime(comparison.capturedAt)}`
                : 'capture time unknown'
              : diffedAt
                ? `as of ${formatTime(diffedAt)}`
                : ''
          }
          objects={diff?.currentCount ?? comparison?.counts.objects ?? 0}
        />
      </div>

      {notes.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 bg-i3x-warning/5 border border-i3x-warning/30 rounded-xl px-4 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-i3x-warning">
            Worth knowing
          </span>
          {notes.map(note => (
            <span key={note} className="text-[12px] text-i3x-text">
              {note}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ProvenanceSide({
  label,
  serverUrl,
  when,
  objects,
}: {
  label: string
  serverUrl: string
  when: string
  objects: number
}) {
  return (
    <div className="bg-i3x-surface border border-i3x-border rounded-xl px-4 py-2.5 min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-i3x-text-muted">
        {label}
      </div>
      <div className="text-[12.5px] font-mono text-i3x-text truncate mt-1" title={serverUrl}>
        {serverUrl}
      </div>
      <div className="text-[11.5px] text-i3x-text-muted mt-0.5">
        {objects.toLocaleString()} objects{when && ` · ${when}`}
      </div>
    </div>
  )
}

function DiffBody({
  diff,
  subtrees,
  baseline,
  baselineIndex,
  comparisonIndex,
}: {
  diff: CatalogDiff
  subtrees: ChangedSubtree[]
  baseline: Snapshot
  baselineIndex: Map<string, ObjectInstance>
  comparisonIndex: Map<string, ObjectInstance> | null
}) {
  const [chosen, setChosen] = useState<CategoryKey | null>(null)

  // Hide the metadata pill entirely when metadata wasn't compared, a zero
  // there would be a claim the diff never checked.
  const visibleCategories = CATEGORIES.filter(c => c.key !== 'metadataOnly' || diff.deepCompared)
  const firstNonEmpty = visibleCategories.find(c => categoryCount(diff, c.key) > 0)?.key ?? 'added'
  const active = chosen !== null && categoryCount(diff, chosen) > 0 ? chosen : firstNonEmpty

  return (
    <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden flex flex-col px-3 sm:px-5 py-3 gap-3">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Change categories">
        {visibleCategories.map(({ key, label }) => {
          const count = categoryCount(diff, key)
          const isActive = key === active
          return (
            <button
              key={key}
              type="button"
              disabled={count === 0}
              aria-pressed={isActive}
              onClick={() => setChosen(key)}
              className={`px-2.5 py-1 rounded-full text-[11.5px] border transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary ${
                isActive
                  ? 'bg-i3x-primary text-white border-i3x-primary'
                  : count === 0
                    ? 'text-i3x-text-muted/50 border-i3x-border cursor-default'
                    : 'text-i3x-text border-i3x-border hover:border-i3x-primary'
              }`}
            >
              {label} <span className="tabular-nums font-medium">{count.toLocaleString()}</span>
            </button>
          )
        })}
      </div>

      <div className="flex-1 lg:min-h-0 flex flex-col lg:flex-row gap-3 items-stretch">
        <CategoryList
          key={active}
          category={active}
          diff={diff}
          baselineIndex={baselineIndex}
          comparisonIndex={comparisonIndex}
        />

        <div className="shrink-0 lg:w-80 lg:min-h-0 lg:overflow-y-auto space-y-3">
          <SubtreesCard subtrees={subtrees} />
          <TypesNamespacesCard diff={diff} baseline={baseline} />
        </div>
      </div>
    </div>
  )
}

/** The active category, windowed. Removed rows are visibly non-navigable. */
function CategoryList({
  category,
  diff,
  baselineIndex,
  comparisonIndex,
}: {
  category: CategoryKey
  diff: CatalogDiff
  baselineIndex: Map<string, ObjectInstance>
  comparisonIndex: Map<string, ObjectInstance> | null
}) {
  const { selectElement } = useElementNavigation()
  const liveIndex = useExplorerStore(s => s.objectIndex)
  const typeIndex = useExplorerStore(s => s.typeIndex)
  // Display data for the current side comes from wherever the current side is.
  const currentIndex = comparisonIndex ?? liveIndex

  const items = categoryItems(diff, category)

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })
  const virtualItems = virtualizer.getVirtualItems()
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0
  const paddingBottom =
    virtualItems.length > 0
      ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
      : 0

  const label = CATEGORIES.find(c => c.key === category)?.label ?? category

  // Built only when clicked: a 50k-row category stringifies to tens of MB and
  // nobody pays that on render.
  const buildJson = () => {
    if (category === 'added') {
      return JSON.stringify(
        (items as string[]).map(id => currentIndex.get(id) ?? { elementId: id }),
        null,
        2
      )
    }
    if (category === 'removed') {
      return JSON.stringify(
        (items as string[]).map(id => baselineIndex.get(id) ?? { elementId: id }),
        null,
        2
      )
    }
    return JSON.stringify(items, null, 2)
  }

  return (
    <Card
      title={`${label} · ${items.length.toLocaleString()}`}
      actions={<CopyJsonButton build={buildJson} title={`Copy ${label} as JSON`} />}
      className="flex-1 min-w-0 flex flex-col h-[70vh] lg:h-auto lg:min-h-0"
    >
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto -mx-2" role="list">
        <div style={{ paddingTop, paddingBottom }}>
          {virtualItems.map(virtualItem => {
            const item = items[virtualItem.index]
            const elementId = typeof item === 'string' ? item : item.elementId
            const change = typeof item === 'string' ? null : item
            const isRemoved = category === 'removed'
            const source = isRemoved ? baselineIndex.get(elementId) : currentIndex.get(elementId)
            const navigable = !isRemoved && liveIndex.has(elementId)
            const name = source?.displayName || elementId
            const typeLabel = source ? (typeIndex.get(source.typeId)?.displayName ?? source.typeId) : ''

            const row = (
              <>
                <span className="flex items-baseline gap-2 min-w-0">
                  <span className={`text-[13px] truncate ${isRemoved ? 'text-i3x-text-muted line-through decoration-i3x-text-muted/50' : 'text-i3x-text'}`}>
                    {name}
                  </span>
                  {typeLabel && (
                    <span className="text-[11px] text-i3x-text-muted truncate shrink-0 max-w-[12rem]">
                      {typeLabel}
                    </span>
                  )}
                  {isRemoved && (
                    <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wider text-i3x-text-muted border border-i3x-border rounded-full px-1.5 py-px">
                      removed
                    </span>
                  )}
                </span>
                <span className="block text-[11px] font-mono text-i3x-text-muted truncate mt-0.5">
                  {change ? changeSummary(change) : elementId}
                </span>
              </>
            )

            return (
              <div key={elementId} role="listitem" style={{ height: ROW_HEIGHT }} className="px-2">
                {navigable ? (
                  <button
                    type="button"
                    onClick={() => selectElement(elementId)}
                    title={`${elementId} · click to open`}
                    className="w-full h-full text-left px-2 rounded-lg hover:bg-i3x-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary flex flex-col justify-center min-w-0"
                  >
                    {row}
                  </button>
                ) : (
                  <div
                    title={isRemoved ? `${elementId} · not in the current catalog` : elementId}
                    className="w-full h-full px-2 flex flex-col justify-center min-w-0 opacity-80"
                  >
                    {row}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}

function deltaText(label: string, delta: FieldDelta): string {
  return `${label}: ${delta.from ?? '(none)'} → ${delta.to ?? '(none)'}`
}

function changeSummary(change: ObjectChange): string {
  const parts: string[] = []
  if (change.parentId) parts.push(deltaText('parent', change.parentId))
  if (change.typeId) parts.push(deltaText('type', change.typeId))
  if (change.displayName) parts.push(deltaText('name', change.displayName))
  if (change.namespaceUri) parts.push(deltaText('namespace', change.namespaceUri))
  if (change.metadataOnly) parts.push('metadata changed')
  return parts.join(' · ') || change.elementId
}

/** Where in the model the change landed: the busiest root-level ancestors. */
function SubtreesCard({ subtrees }: { subtrees: ChangedSubtree[] }) {
  const { selectElement } = useElementNavigation()
  const liveIndex = useExplorerStore(s => s.objectIndex)

  if (subtrees.length === 0) return null

  return (
    <Card
      title="Most-changed subtrees"
      actions={
        <InfoHint label="How are changes grouped?" title="Most-changed subtrees">
          Every added, removed or changed object counts against the top-level object it sits under.
          Removed objects are placed using the baseline, since their parents may be gone too. Click
          a root to open it. Roots that no longer exist can't be opened.
        </InfoHint>
      }
    >
      <ul className="space-y-0.5">
        {subtrees.map(subtree => {
          const navigable = liveIndex.has(subtree.rootId)
          const body = (
            <>
              <span className="text-[13px] text-i3x-text truncate">{subtree.label}</span>
              <span className="ml-auto shrink-0 text-[12px] text-i3x-text-muted tabular-nums">
                {subtree.changes.toLocaleString()} {subtree.changes === 1 ? 'change' : 'changes'}
              </span>
            </>
          )
          return (
            <li key={subtree.rootId}>
              {navigable ? (
                <button
                  type="button"
                  onClick={() => selectElement(subtree.rootId)}
                  title={`${subtree.rootId} · click to open`}
                  className="w-full flex items-baseline gap-3 px-2 py-1.5 rounded-lg text-left hover:bg-i3x-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
                >
                  {body}
                </button>
              ) : (
                <div
                  title={`${subtree.rootId} · not in the current catalog`}
                  className="w-full flex items-baseline gap-3 px-2 py-1.5 opacity-70"
                >
                  {body}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/** Type and namespace membership changes, usually short, never virtualized. */
function TypesNamespacesCard({ diff, baseline }: { diff: CatalogDiff; baseline: Snapshot }) {
  const typeIndex = useExplorerStore(s => s.typeIndex)
  const baselineTypeLabels = useMemo(
    () => new Map(baseline.objectTypes.map(t => [t.elementId, t.displayName || t.elementId])),
    [baseline.objectTypes]
  )

  const rows: { key: string; sign: '+' | '−'; text: string }[] = []
  for (const id of diff.typesAdded) {
    rows.push({ key: `t+${id}`, sign: '+', text: `type ${typeIndex.get(id)?.displayName ?? id}` })
  }
  for (const id of diff.typesRemoved) {
    rows.push({ key: `t-${id}`, sign: '−', text: `type ${baselineTypeLabels.get(id) ?? id}` })
  }
  for (const uri of diff.namespacesAdded) {
    rows.push({ key: `n+${uri}`, sign: '+', text: `namespace ${uri}` })
  }
  for (const uri of diff.namespacesRemoved) {
    rows.push({ key: `n-${uri}`, sign: '−', text: `namespace ${uri}` })
  }

  if (rows.length === 0) return null

  return (
    <Card title="Types & namespaces">
      <ul className="space-y-1">
        {rows.map(row => (
          <li key={row.key} className="flex items-baseline gap-2 text-[12.5px] min-w-0">
            <span className="shrink-0 w-4 text-center font-mono text-i3x-text-muted">{row.sign}</span>
            <span className="text-i3x-text truncate" title={row.text}>
              {row.text}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}
