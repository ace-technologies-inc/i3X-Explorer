import { Card } from '../main/primitives'
import { InfoHint } from '../main/InfoHint'
import { useElementNavigation } from '../main/navigation'
import { MIN_ANOMALY_SCORE, type AnomalyEntry } from '../main/insightsReport'

/**
 * The objects that break the most independent norms at once. One violation is
 * an exception; several on the same object is a smell worth a look. This is
 * the interpretable version of an "anomaly score": every point is a named,
 * checkable reason, not model output.
 *
 * Each row carries where the object sits and its elementId, because display
 * names repeat: on a real catalog two rows rendered character for character
 * identically, which is exactly the failure this section exists to fix.
 */
export function AnomaliesSection({ anomalies }: { anomalies: AnomalyEntry[] }) {
  const { selectElement } = useElementNavigation()
  if (anomalies.length === 0) return null

  return (
    <Card
      title={`Most anomalous objects · ${anomalies.length.toLocaleString()}`}
      actions={
        <InfoHint label="How is anomaly scored?" title="Most anomalous objects">
          The score is how many separate conventions one object breaks: a missing child, an
          unusual parent, a name off the pattern. Objects breaking at least {MIN_ANOMALY_SCORE}{' '}
          are listed, worst first, and every point comes with its reason so you can check it.
        </InfoHint>
      }
    >
      <ul className="space-y-0.5">
        {anomalies.map(anomaly => (
          <li key={anomaly.elementId}>
            <button
              type="button"
              onClick={() => selectElement(anomaly.elementId)}
              title={`${anomaly.elementId} · click to open`}
              className="w-full px-2 py-1.5 rounded-lg text-left hover:bg-i3x-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary min-w-0"
            >
              <span className="flex items-baseline gap-3 min-w-0">
                <span className="shrink-0 w-5 text-center text-[12px] font-semibold text-i3x-warning tabular-nums">
                  {anomaly.score}
                </span>
                <span className="text-[13px] text-i3x-text truncate">{anomaly.label}</span>
                <span className="text-[11px] text-i3x-text-muted truncate">
                  {anomaly.typeLabel}
                </span>
                <span
                  className="ml-auto text-[11px] text-i3x-text-muted truncate max-w-[50%]"
                  title={anomaly.reasons.join(' · ')}
                >
                  {anomaly.reasons.join(' · ')}
                </span>
              </span>
              {/* Where it sits and its id: two objects can share a name and a
                  type, but not both of these. */}
              <span className="flex items-baseline gap-2 pl-8 min-w-0">
                <span className="text-[10.5px] text-i3x-text-muted/80 truncate">
                  under {anomaly.context}
                </span>
                <span className="text-[10.5px] font-mono text-i3x-text-muted/60 truncate">
                  {anomaly.elementId}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
