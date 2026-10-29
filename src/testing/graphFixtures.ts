import type { ObjectInstance } from '../api/types'
import type { EgoGraph } from '../components/graph/egoGraph'

/** The pane size the graph tests measure, since jsdom has no layout. */
export const TEST_PANE = { width: 1000, height: 600 }

class FixedSizeResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback([{ contentRect: TEST_PANE } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
  unobserve() {}
  disconnect() {}
}

/** Reports TEST_PANE to every observer; returns the restore function. */
export function installFixedPane(): () => void {
  const original = globalThis.ResizeObserver
  globalThis.ResizeObserver = FixedSizeResizeObserver as unknown as typeof ResizeObserver
  return () => {
    globalThis.ResizeObserver = original
  }
}

function graphObject(elementId: string, parentId: string | null): ObjectInstance {
  return { elementId, displayName: elementId, typeId: 'T', parentId, isComposition: false, namespaceUri: 'urn:x' }
}

/** A root with `count` direct children, as a walk would return it. */
export function fanGraph(count: number): { root: ObjectInstance; graph: EgoGraph } {
  const root = graphObject('root', null)
  const graph: EgoGraph = { nodes: [{ object: root, depth: 0 }], edges: [] }
  for (let index = 0; index < count; index++) {
    const child = graphObject(`child-${index}`, 'root')
    graph.nodes.push({ object: child, depth: 1, via: 'root', viaBucket: 'child' })
    graph.edges.push({ source: 'root', target: child.elementId, bucket: 'child' })
  }
  return { root, graph }
}
