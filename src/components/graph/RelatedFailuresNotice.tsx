import type { ElementFailure } from '../../api/client'
import { Chevron } from '../common/Chevron'

const MAX_LISTED = 20

/** Elements the walk could not expand, with the server's reasons; an empty live region when all succeeded. */
export function RelatedFailuresNotice({ failures, className = '' }: { failures?: ElementFailure[]; className?: string }) {
  // The live region stays mounted (and empty) so screen readers announce failures when they appear.
  if (!failures || failures.length === 0) return <div role="status" />
  const listed = failures.slice(0, MAX_LISTED)
  return (
    <div role="status" className={`shrink-0 ${className}`}>
      <details className="group rounded-lg border border-i3x-warning/30 bg-i3x-warning/10 px-3 py-1.5 text-xs text-i3x-warning">
        <summary className="flex cursor-pointer items-center gap-1.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary">
          <Chevron />
          {failures.length === 1
            ? `Couldn't load relationships for ${failures[0].elementId}; it is drawn without them.`
            : `Couldn't load relationships for ${failures.length} elements; they are drawn without them.`}
        </summary>
        <ul className="mt-1.5 max-h-40 space-y-1 overflow-auto pl-5">
          {listed.map((failure, index) => (
            <li key={`${failure.elementId}-${index}`} className="break-all">
              <span className="font-mono">{failure.elementId}</span>: {failure.message}
            </li>
          ))}
          {failures.length > listed.length && <li>…and {failures.length - listed.length} more</li>}
        </ul>
      </details>
    </div>
  )
}
