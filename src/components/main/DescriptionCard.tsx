import { FormattedText } from '../common/FormattedText'
import { Spinner } from '../common/Spinner'
import { Card } from './primitives'

/**
 * The Description card every detail view opens with. The text comes from the
 * entity's own `description`, else `metadata.description` (where i3X 1.0 puts a
 * namespace's, since a namespace declares no member for it), and renders in the
 * format `metadata.system.descriptionMime` names.
 */
export function DescriptionCard({
  description,
  metadata,
  pending = false,
  error = null,
  onRetry,
}: {
  description?: string
  metadata?: Record<string, unknown>
  /** The full entity is still on its way; show a loader instead of "none". */
  pending?: boolean
  /** The full entity could not be loaded; show why instead of "none". */
  error?: string | null
  onRetry?: () => void
}) {
  const text =
    description || (typeof metadata?.description === 'string' ? metadata.description : undefined)
  const system = metadata?.system
  const mimeType =
    system && typeof system === 'object'
      ? (system as Record<string, unknown>).descriptionMime
      : undefined

  return (
    <Card title="Description">
      {text ? (
        <FormattedText mimeType={mimeType}>{text}</FormattedText>
      ) : pending ? (
        <p className="flex items-center gap-2 text-[13.5px] text-i3x-text-muted">
          <Spinner size={13} /> Loading details…
        </p>
      ) : error ? (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-i3x-error">
          <span>Details could not be loaded: {error}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="px-2 py-0.5 rounded border border-i3x-border text-i3x-text hover:bg-i3x-bg transition-colors motion-reduce:transition-none"
            >
              Retry
            </button>
          )}
        </div>
      ) : (
        <p className="text-[13.5px] text-i3x-text-muted">No description provided.</p>
      )}
    </Card>
  )
}
