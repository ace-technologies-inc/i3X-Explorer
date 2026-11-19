import { useElementLinkStore } from '../../services/elementLink'
import { CloseIcon, WarningIcon } from './icons'

/** Says why a shared link that was opened could not be followed; stays until dismissed. */
export function ElementLinkNotice() {
  const notice = useElementLinkStore(s => s.notice)
  const dismiss = useElementLinkStore(s => s.dismissNotice)
  if (!notice) return null

  return (
    <div
      role="status"
      className="fixed bottom-10 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-xl flex items-start gap-2.5 bg-i3x-surface border border-i3x-warning/40 rounded-lg shadow-xl px-3.5 py-2.5"
    >
      <WarningIcon size={15} className="text-i3x-warning flex-shrink-0 mt-0.5" />
      <p className="flex-1 min-w-0 text-xs text-i3x-text break-words">{notice}</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="flex-shrink-0 text-i3x-text-muted hover:text-i3x-text rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
      >
        <CloseIcon size={14} />
      </button>
    </div>
  )
}
