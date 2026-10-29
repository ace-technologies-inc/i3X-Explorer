import { CloseIcon } from '../common/icons'

/**
 * The "you are looking at one branch" chip, shown by both map views while a
 * subtree focus is held.
 *
 * A focus that only dims the rest is a state with no way out: the drawing looks
 * broken rather than filtered, and the way back (Reset view) doesn't announce
 * itself. So the focus says what it is, and carries its own exit.
 */
export function FocusBadge({
  name,
  count,
  onClear,
}: {
  name: string
  /** Objects lit: the focused node plus everything under it in the walk. */
  count: number
  onClear: () => void
}) {
  return (
    <div className="absolute left-3 bottom-3 max-w-[280px] flex items-center gap-2 bg-i3x-surface border border-i3x-primary/60 rounded-lg pl-2.5 pr-1 py-1 text-xs">
      <span className="min-w-0 truncate text-i3x-text" title={name}>
        Focused on <b className="font-medium">{name}</b>
      </span>
      <span className="shrink-0 tabular-nums text-[10.5px] text-i3x-text-muted">
        {count.toLocaleString()}
      </span>
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear focus"
        title="Clear focus"
        className="shrink-0 w-5 h-5 grid place-items-center rounded text-i3x-text-muted hover:text-i3x-text hover:bg-i3x-bg transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
      >
        <CloseIcon size={12} />
      </button>
    </div>
  )
}
