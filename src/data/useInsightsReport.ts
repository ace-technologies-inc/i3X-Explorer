import { useEffect, useState } from 'react'
import type { ObjectInstance, ObjectType } from '../api/types'
import { peekInsightsReport, type InsightsResult } from '../components/main/insightsReport'
import { useExplorerStore } from '../stores/explorer'
import { catalogInsightsReport } from './catalogData'

/**
 * Hierarchy stats and model insights for these store collections, computed off
 * the main thread. Null until the first result arrives; after that, a newer
 * catalog shows the previous result until its own is ready.
 */
export function useInsightsReport(
  objects: ObjectInstance[],
  objectTypes: ObjectType[],
  namespaceCount: number
): InsightsResult | null {
  // The engine can only answer once it holds the catalog on screen.
  const detailsFingerprint = useExplorerStore(state => state.catalogDetailsFingerprint)
  const ready = peekInsightsReport(objects, objectTypes, namespaceCount)
  const [latest, setLatest] = useState<InsightsResult | null>(ready)

  useEffect(() => {
    if (ready || objects.length === 0) return
    let current = true
    catalogInsightsReport(objects, objectTypes, namespaceCount).then(
      result => {
        if (current && result) setLatest(result)
      },
      err => console.error('Model insights failed:', err)
    )
    return () => {
      current = false
    }
  }, [ready, objects, objectTypes, namespaceCount, detailsFingerprint])

  return ready ?? latest
}
