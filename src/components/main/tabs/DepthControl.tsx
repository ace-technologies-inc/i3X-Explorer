import {
  MAX_RELATIONSHIP_DEPTH,
  MIN_RELATIONSHIP_DEPTH,
  useExplorerStore,
} from '../../../stores/explorer'

/**
 * Depth picker shared by the Relationships and Subtree tabs: a pill per hop from
 * MIN up to however many have been revealed, then a "+" that reveals one more.
 * The revealed count is session state in the store, shared by both pickers,
 * since revealing a deeper pill means "I go deep on this model", not "on this
 * tab", so the extra pills stay put when you switch elements or tabs.
 */
export function DepthControl({
  value,
  onChange,
}: {
  value: number
  onChange: (depth: number) => void
}) {
  const revealed = useExplorerStore(state => state.relationshipDepthShown)
  const reveal = useExplorerStore(state => state.revealRelationshipDepth)

  // Always show at least up to the current depth, so the active pill can't vanish.
  const shown = Math.max(revealed, value)
  const depths = Array.from(
    { length: shown - MIN_RELATIONSHIP_DEPTH + 1 },
    (_, index) => MIN_RELATIONSHIP_DEPTH + index
  )

  const pill =
    'px-3 py-1 text-[11.5px] rounded-md transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary'
  const active = 'bg-i3x-surface text-i3x-primary font-medium shadow-sm'
  const inactive = 'text-i3x-text-muted hover:text-i3x-text'

  return (
    <div
      role="group"
      aria-label="Depth in hops"
      className="flex items-center gap-0.5 bg-i3x-bg border border-i3x-border rounded-lg p-0.5"
    >
      {depths.map(depth => (
        <button
          key={depth}
          type="button"
          aria-pressed={value === depth}
          onClick={() => onChange(depth)}
          className={`${pill} ${value === depth ? active : inactive}`}
        >
          {depth}
        </button>
      ))}

      {shown < MAX_RELATIONSHIP_DEPTH && (
        <button
          type="button"
          aria-label="Reveal a deeper depth"
          title="Add a deeper depth"
          onClick={reveal}
          className={`${pill} ${inactive}`}
        >
          +
        </button>
      )}
    </div>
  )
}
