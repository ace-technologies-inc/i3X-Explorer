import { create } from 'zustand'
import { useExplorerStore } from './explorer'
import { useConnectionStore } from './connection'
import type { ObjectInstance } from '../api/types'
import {
  buildObjectIndex,
  diffCatalogs,
  topChangedSubtrees,
  type CatalogDiff,
  type CatalogSide,
  type ChangedSubtree,
} from '../components/diff/diffEngine'
import {
  SnapshotFormatError,
  decodeSnapshotBytes,
  parseSnapshot,
  suggestSnapshotFilename,
  type Snapshot,
} from '../components/diff/snapshot'
import { catalogMetadataKeyer, catalogSnapshotBlob } from '../data/catalogData'

/**
 * Snapshot & diff state, deliberately its own store: loading a baseline must
 * leave the explorer store, and therefore the tree, completely untouched. A
 * loaded baseline is a second full catalog held in memory (~2× the footprint);
 * the diff *result* is small (elementIds and field pairs only), so keeping it
 * around while the view is closed costs nothing worth reclaiming.
 *
 * Capture reads the already-fetched catalog straight out of the stores, zero
 * network requests. If you want a fresher snapshot, refresh first; that's your
 * call, not a capture side effect.
 *
 * The right-hand side of the diff is the live catalog by default; loading a
 * comparison file swaps it for a second snapshot (environment-vs-environment).
 *
 * Whether the *view* is showing is not state here: the diff page is a stop in
 * the navigation history (`activePage` in stores/explorer.ts), so Back returns
 * to it like any other page. openView/closeView below are the two words for
 * that, kept so callers don't have to know where the panel state lives.
 */

export type DiffBusy = 'reading' | 'diffing' | 'saving' | null

interface DiffState {
  /** The loaded baseline snapshot (left side), null when none. */
  baseline: Snapshot | null
  /** Last-wins index over the baseline's objects, built once at load. */
  baselineIndex: Map<string, ObjectInstance>
  /** Non-fatal problems from parsing the baseline file (dropped entries). */
  baselineWarnings: string[]
  /** Optional second snapshot as the right side; null = diff against the live catalog. */
  comparison: Snapshot | null
  comparisonIndex: Map<string, ObjectInstance> | null
  comparisonWarnings: string[]

  diff: CatalogDiff | null
  subtrees: ChangedSubtree[]
  /** When the diff last ran, the "as of" for a live right side. */
  diffedAt: string | null

  busy: DiffBusy
  error: string | null
  /** Opt-in metadata/schemaExtensions comparison; re-runs the diff on change. */
  deepCompare: boolean

  captureAndSave: () => Promise<void>
  loadBaselineFile: (file: File) => Promise<void>
  loadComparisonFile: (file: File) => Promise<void>
  /** Drop the comparison snapshot and diff against the live catalog again. */
  clearComparison: () => void
  runDiff: () => void
  setDeepCompare: (on: boolean) => void
  openView: () => void
  closeView: () => void
  clearBaseline: () => void
  clearError: () => void
}

function errorMessage(err: unknown): string {
  if (err instanceof SnapshotFormatError) return err.message
  return err instanceof Error ? err.message : String(err)
}

/** Anchor-download: identical in Electron and the web build, no IPC. */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  // Revoke later, revoking synchronously can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const useDiffStore = create<DiffState>((set, get) => ({
  baseline: null,
  baselineIndex: new Map(),
  baselineWarnings: [],
  comparison: null,
  comparisonIndex: null,
  comparisonWarnings: [],
  diff: null,
  subtrees: [],
  diffedAt: null,
  busy: null,
  error: null,
  deepCompare: false,

  captureAndSave: async () => {
    const explorer = useExplorerStore.getState()
    if (explorer.allObjects.length === 0) return
    set({ busy: 'saving', error: null })
    try {
      const serverUrl = useConnectionStore.getState().serverUrl
      const capturedAt = new Date().toISOString()
      const blob = await catalogSnapshotBlob({
        appVersion: __APP_VERSION__,
        serverUrl,
        capturedAt,
        namespaces: explorer.namespaces,
        objectTypes: explorer.objectTypes,
      })
      downloadBlob(blob, suggestSnapshotFilename(serverUrl, capturedAt))
      set({ busy: null })
    } catch (err) {
      // Save failures are rare (no network involved); surface them in the panel.
      set({ busy: null, error: `Could not save snapshot: ${errorMessage(err)}` })
      get().openView()
    }
  },

  loadBaselineFile: async (file) => {
    // Open the view first so "Reading snapshot…" (and any error) has a home.
    set({ busy: 'reading', error: null })
    get().openView()
    try {
      const text = await decodeSnapshotBytes(await file.arrayBuffer())
      const { snapshot, warnings } = parseSnapshot(text)
      set({
        baseline: snapshot,
        baselineIndex: buildObjectIndex(snapshot.objects),
        baselineWarnings: warnings,
        diff: null,
        subtrees: [],
        diffedAt: null,
        busy: null,
      })
      get().runDiff()
    } catch (err) {
      set({ busy: null, error: `"${file.name}": ${errorMessage(err)}` })
    }
  },

  loadComparisonFile: async (file) => {
    set({ busy: 'reading', error: null })
    get().openView()
    try {
      const text = await decodeSnapshotBytes(await file.arrayBuffer())
      const { snapshot, warnings } = parseSnapshot(text)
      set({
        comparison: snapshot,
        comparisonIndex: buildObjectIndex(snapshot.objects),
        comparisonWarnings: warnings,
        busy: null,
      })
      get().runDiff()
    } catch (err) {
      set({ busy: null, error: `"${file.name}": ${errorMessage(err)}` })
    }
  },

  clearComparison: () => {
    set({ comparison: null, comparisonIndex: null, comparisonWarnings: [] })
    get().runDiff()
  },

  runDiff: () => {
    if (!get().baseline) return
    set({ busy: 'diffing', error: null })
    // Let the "Computing diff…" frame paint before the synchronous compute,
    // ~50ms scalar / ~200ms deep at 100k (see diffEngine.perf.test.ts), well
    // under a worker's complexity but long enough to want the affordance.
    setTimeout(async () => {
      const { baseline, baselineIndex, comparison, comparisonIndex, deepCompare } = get()
      if (!baseline) {
        set({ busy: null })
        return
      }
      // The live catalog is listed without metadata; its metadata keys come from the server.
      const explorer = useExplorerStore.getState()
      let liveMetadataKey: ((object: ObjectInstance) => string) | undefined
      if (deepCompare && !comparison) {
        try {
          liveMetadataKey = await catalogMetadataKeyer()
          const current = useExplorerStore.getState()
          if (current.allObjects !== explorer.allObjects || current.allObjectsFingerprint !== explorer.allObjectsFingerprint) {
            throw new Error('The catalog refreshed while its metadata was loading. Run the diff again.')
          }
        } catch (err) {
          set({ busy: null, error: errorMessage(err) })
          return
        }
      }
      const baselineSide: CatalogSide = {
        objects: baseline.objects,
        objectTypes: baseline.objectTypes,
        namespaces: baseline.namespaces,
        objectIndex: baselineIndex,
      }
      const currentSide: CatalogSide = comparison
        ? {
            objects: comparison.objects,
            objectTypes: comparison.objectTypes,
            namespaces: comparison.namespaces,
            objectIndex: comparisonIndex ?? undefined,
          }
        : {
            objects: explorer.allObjects,
            objectTypes: explorer.objectTypes,
            namespaces: explorer.namespaces,
            // Reuse the store's prebuilt index instead of building a second one.
            objectIndex: explorer.objectIndex,
            metadataKey: liveMetadataKey,
          }
      const diff = diffCatalogs(baselineSide, currentSide, { deepCompare })
      const currentIndex = comparison
        ? (comparisonIndex ?? buildObjectIndex(comparison.objects))
        : explorer.objectIndex
      const subtrees = topChangedSubtrees(diff, baselineIndex, currentIndex)
      set({ diff, subtrees, diffedAt: new Date().toISOString(), busy: null })
    }, 0)
  },

  setDeepCompare: (on) => {
    set({ deepCompare: on })
    get().runDiff()
  },

  // The page itself is a history stop, so opening and leaving it are ordinary
  // navigations: Back from a diff row returns to the diff, not past it.
  openView: () => useExplorerStore.getState().openPage('diff'),
  closeView: () => {
    const explorer = useExplorerStore.getState()
    if (explorer.activePage === 'diff') explorer.closePage()
  },

  clearBaseline: () => {
    get().closeView()
    set({
      baseline: null,
      baselineIndex: new Map(),
      baselineWarnings: [],
      comparison: null,
      comparisonIndex: null,
      comparisonWarnings: [],
      diff: null,
      subtrees: [],
      diffedAt: null,
      error: null,
    })
  },

  clearError: () => set({ error: null }),
}))
