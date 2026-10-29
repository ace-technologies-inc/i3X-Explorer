import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildTreeRows,
  groupRelatedObjects,
  isHierarchicalRelationship,
  loadChildrenFor,
  resolveRelationshipGroups,
  HIERARCHICAL_FOLDER_ID,
  NAMESPACES_FOLDER_ID,
  OBJECTS_FOLDER_ID,
  type TreeBuildInput,
  type TreeRow,
  type NodeRow,
} from './treeData'
import { CHILD_PAGE_SIZE, CHILD_PAGE_SLACK, relationshipSourceRowId, useExplorerStore } from '../../stores/explorer'
import type { Namespace, ObjectInstance, RelationshipType } from '../../api/types'
import { createClient, destroyClient, I3XClient, type CatalogBody } from '../../api/client'
import { ensureAllObjectsLoaded, loadHierarchicalRoots } from '../../services/catalog'
import { resetCatalogEngine } from '../../data/catalogData'

// Catalog loads resolve namespaces from the object types.
beforeEach(() => {
  vi.spyOn(I3XClient.prototype, 'getObjectTypes').mockResolvedValue([])
})

afterEach(() => {
  destroyClient()
  resetCatalogEngine()
  useExplorerStore.getState().reset()
  vi.restoreAllMocks()
})

function obj(elementId: string, over: Partial<ObjectInstance> = {}): ObjectInstance {
  return {
    elementId,
    displayName: elementId,
    typeId: 'T',
    parentId: null,
    isComposition: false,
    namespaceUri: 'urn:ns',
    ...over,
  }
}

function input(over: Partial<TreeBuildInput> = {}): TreeBuildInput {
  return {
    namespaces: [],
    objectTypes: [],
    relationshipTypes: [],
    objectsByType: new Map(),
    allObjects: [],
    hierarchicalRoots: [],
    childObjects: new Map(),
    childrenByParent: new Map(),
    compositionCache: new Map(),
    expandedNodes: new Set(),
    childPageLimits: new Map(),
    filterText: '',
    selectedId: null,
    objectIndex: new Map(),
    searchIndex: new Map(),
    objectCountByType: new Map(),
    catalogObjectsByType: new Map(),
    showRelationshipsInTree: false,
    showComponentsInTree: true,
    relatedObjects: new Map(),
    hierarchyComponents: new Map(),
    relationshipInstances: new Map(),
    ...over,
  }
}

const nodeIndexOf = (rows: TreeRow[], id: string) =>
  rows.findIndex(r => r.kind === 'node' && r.id === id)

const markerMessages = (rows: TreeRow[]) =>
  rows.filter(r => r.kind === 'marker').map(r => r.message)

function rootFolderRow(id: string): NodeRow {
  return {
    kind: 'node',
    id,
    nodeType: 'folder',
    label: id,
    depth: 0,
    hasChildren: true,
    isExpanded: false,
    parentIndex: -1,
  } as NodeRow
}

function objectBytes(objects: ObjectInstance[]): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(objects)).buffer
}

function catalogBody(objects: ObjectInstance[], etag: string | null = null): CatalogBody {
  return { notModified: false, buffer: objectBytes(objects), etag }
}

describe('root folder catalog loading', () => {
  it('reuses the loaded catalog instead of fetching it again', async () => {
    useExplorerStore.getState().setAllObjects([obj('cached')])
    const client = createClient('http://server')
    const getBytes = vi.spyOn(client, 'getObjectCatalogBytes').mockResolvedValue(catalogBody([]))

    await loadChildrenFor(rootFolderRow(OBJECTS_FOLDER_ID))

    expect(getBytes).not.toHaveBeenCalled()
  })

  it('requests only the filtered roots when opening Hierarchy with a loaded catalog', async () => {
    useExplorerStore.getState().setAllObjects([obj('cached')])
    const client = createClient('http://server')
    // The server's root=true query decides the roots.
    const getRoots = vi.spyOn(client, 'getRootObjectBytes').mockResolvedValue(objectBytes([obj('root')]))

    await loadChildrenFor(rootFolderRow(HIERARCHICAL_FOLDER_ID))

    expect(getRoots).toHaveBeenCalledOnce()
    expect(useExplorerStore.getState().hierarchicalRoots.map(object => object.elementId)).toEqual(['root'])
    expect(useExplorerStore.getState().allObjects.map(object => object.elementId)).toEqual(['cached'])
  })

  it('reuses the catalog objects as roots, so an unchanged roots refresh leaves the store alone', async () => {
    const client = createClient('http://server')
    const objects = [obj('a'), obj('b', { parentId: 'a' })]
    vi.spyOn(client, 'getObjectCatalogBytes').mockResolvedValue(catalogBody(objects))
    vi.spyOn(client, 'getRootObjectBytes').mockImplementation(async () => objectBytes(objects.slice(0, 1)))
    await ensureAllObjectsLoaded(client, { force: true })

    await loadHierarchicalRoots(client)
    const roots = useExplorerStore.getState().hierarchicalRoots
    await loadHierarchicalRoots(client)

    expect(roots).toHaveLength(1)
    expect(roots[0]).toBe(useExplorerStore.getState().objectIndex.get('a'))
    expect(useExplorerStore.getState().hierarchicalRoots).toBe(roots)
  })

  it('loads the catalog when it has not been loaded yet', async () => {
    const client = createClient('http://server')
    const getBytes = vi.spyOn(client, 'getObjectCatalogBytes').mockResolvedValue(catalogBody([obj('loaded')]))

    await loadChildrenFor(rootFolderRow(OBJECTS_FOLDER_ID))

    expect(getBytes).toHaveBeenCalledOnce()
    expect(useExplorerStore.getState().allObjectsLoaded).toBe(true)
    expect(useExplorerStore.getState().allObjects.map(object => object.elementId)).toEqual(['loaded'])
  })

  it('shares the connection catalog load with folder expansion even while isLoading is true', async () => {
    useExplorerStore.getState().setLoading(true)
    const client = createClient('http://server')
    let resolveBody!: (body: CatalogBody) => void
    const body = new Promise<CatalogBody>(resolve => {
      resolveBody = resolve
    })
    const getBytes = vi.spyOn(client, 'getObjectCatalogBytes').mockReturnValue(body)

    const connectLoad = ensureAllObjectsLoaded(client, { force: true, invalidateCurrent: true })
    const folderLoad = loadChildrenFor(rootFolderRow(OBJECTS_FOLDER_ID))

    expect(getBytes).toHaveBeenCalledOnce()
    resolveBody(catalogBody([obj('loaded')]))
    await Promise.all([connectLoad, folderLoad])

    expect(useExplorerStore.getState().allObjects.map(object => object.elementId)).toEqual(['loaded'])
  })

  it('leaves the store untouched when a refresh returns the same bytes', async () => {
    const client = createClient('http://server')
    vi.spyOn(client, 'getObjectCatalogBytes').mockImplementation(async () => catalogBody([obj('a'), obj('b')]))
    await ensureAllObjectsLoaded(client, { force: true })
    const before = useExplorerStore.getState()

    await ensureAllObjectsLoaded(client, { force: true })

    expect(useExplorerStore.getState().allObjects).toBe(before.allObjects)
    expect(useExplorerStore.getState().objectIndex).toBe(before.objectIndex)
    expect(useExplorerStore.getState().catalogDetailsFingerprint).toBe(before.allObjectsFingerprint)
  })

  it('keeps the identity of unchanged objects when a refresh changes others', async () => {
    const client = createClient('http://server')
    let objects = [obj('a'), obj('b')]
    vi.spyOn(client, 'getObjectCatalogBytes').mockImplementation(async () => catalogBody(objects))
    await ensureAllObjectsLoaded(client, { force: true })
    const [a, b] = useExplorerStore.getState().allObjects

    objects = [obj('a'), obj('b', { displayName: 'renamed' })]
    await ensureAllObjectsLoaded(client, { force: true })

    const [nextA, nextB] = useExplorerStore.getState().allObjects
    expect(nextA).toBe(a)
    expect(nextB).not.toBe(b)
    expect(nextB.displayName).toBe('renamed')
  })

  it('revalidates with the last ETag and keeps the store when the server answers 304', async () => {
    const client = createClient('http://server')
    const getBytes = vi.spyOn(client, 'getObjectCatalogBytes')
      .mockResolvedValueOnce(catalogBody([obj('a')], '"c1"'))
      .mockResolvedValueOnce({ notModified: true })
    await ensureAllObjectsLoaded(client, { force: true })
    const before = useExplorerStore.getState()

    await ensureAllObjectsLoaded(client, { force: true })

    expect(getBytes.mock.calls.map(([etag]) => etag)).toEqual([undefined, '"c1"'])
    expect(useExplorerStore.getState().allObjects).toBe(before.allObjects)
    expect(useExplorerStore.getState().allObjectsLoaded).toBe(true)
  })

  it('asks for the full body when the store no longer shows the catalog the ETag names', async () => {
    const client = createClient('http://server')
    const getBytes = vi.spyOn(client, 'getObjectCatalogBytes').mockResolvedValue(catalogBody([obj('a')], '"c1"'))
    await ensureAllObjectsLoaded(client, { force: true })

    await ensureAllObjectsLoaded(client, { force: true, invalidateCurrent: true })

    expect(getBytes.mock.calls.map(([etag]) => etag)).toEqual([undefined, undefined])
  })

  it('stops revalidating when the network refuses the conditional request but not a plain one', async () => {
    const client = createClient('http://server')
    const getBytes = vi.spyOn(client, 'getObjectCatalogBytes').mockImplementation(async etag => {
      if (etag) throw new TypeError('Failed to fetch')
      return catalogBody([obj('a')], '"c1"')
    })
    await ensureAllObjectsLoaded(client, { force: true })

    await ensureAllObjectsLoaded(client, { force: true })
    await ensureAllObjectsLoaded(client, { force: true })

    expect(getBytes.mock.calls.map(([etag]) => etag)).toEqual([undefined, '"c1"', undefined, undefined])
    expect(useExplorerStore.getState().allObjectsLoaded).toBe(true)
  })

  it('keeps revalidating after an outage that fails the plain request too', async () => {
    const client = createClient('http://server')
    let online = true
    const getBytes = vi.spyOn(client, 'getObjectCatalogBytes').mockImplementation(async () => {
      if (!online) throw new TypeError('Failed to fetch')
      return catalogBody([obj('a')], '"c1"')
    })
    await ensureAllObjectsLoaded(client, { force: true })

    online = false
    await expect(ensureAllObjectsLoaded(client, { force: true })).rejects.toThrow(TypeError)
    online = true
    await ensureAllObjectsLoaded(client, { force: true })

    expect(getBytes.mock.calls.map(([etag]) => etag)).toEqual([undefined, '"c1"', undefined, '"c1"'])
  })
})

describe('buildTreeRows: hierarchy walk guards', () => {
  it('emits a cycle marker instead of recursing on a parentId cycle', () => {
    const A = obj('A')
    const B = obj('B', { parentId: 'A' })
    const rows = buildTreeRows(
      input({
        hierarchicalRoots: [A],
        childrenByParent: new Map([
          ['A', [B]],
          ['B', [A]], // the cycle
        ]),
        expandedNodes: new Set([HIERARCHICAL_FOLDER_ID, 'hier:A', 'hier:B']),
      })
    )
    expect(markerMessages(rows)).toContain('(cycle detected)')
    // The walk stopped: A appears once as a node, not twice.
    expect(rows.filter(r => r.kind === 'node' && r.id === 'hier:A')).toHaveLength(1)
  })

  it('emits a max-depth marker on a chain deeper than MAX_TREE_DEPTH', () => {
    const chain = Array.from({ length: 25 }, (_, i) =>
      obj(`c${i}`, { parentId: i === 0 ? null : `c${i - 1}` })
    )
    const childrenByParent = new Map(chain.slice(0, -1).map((o, i) => [o.elementId, [chain[i + 1]]]))
    const rows = buildTreeRows(
      input({
        hierarchicalRoots: [chain[0]],
        childrenByParent,
        expandedNodes: new Set([HIERARCHICAL_FOLDER_ID, ...chain.map(o => `hier:${o.elementId}`)]),
      })
    )
    expect(markerMessages(rows)).toContain('(max depth reached)')
  })
})

describe('buildTreeRows: paging', () => {
  const bigFamily = (childCount: number) => {
    const parent = obj('P')
    const kids = Array.from({ length: childCount }, (_, i) => obj(`k${i}`, { parentId: 'P' }))
    return input({
      hierarchicalRoots: [parent],
      childrenByParent: new Map([['P', kids]]),
      expandedNodes: new Set([HIERARCHICAL_FOLDER_ID, 'hier:P']),
      objectIndex: new Map([parent, ...kids].map(o => [o.elementId, o])),
    })
  }

  it('pages past CHILD_PAGE_SIZE + SLACK with an accurate "more" row', () => {
    const rows = buildTreeRows(bigFamily(CHILD_PAGE_SIZE + CHILD_PAGE_SLACK + 10))
    const childRows = rows.filter(r => r.kind === 'node' && r.id.startsWith('hier:k'))
    expect(childRows).toHaveLength(CHILD_PAGE_SIZE)
    const more = rows.find(r => r.kind === 'more')
    expect(more).toMatchObject({
      parentId: 'hier:P',
      shown: CHILD_PAGE_SIZE,
      hidden: CHILD_PAGE_SLACK + 10,
    })
  })

  it('does not truncate a trivial overflow (within the slack)', () => {
    const rows = buildTreeRows(bigFamily(CHILD_PAGE_SIZE + CHILD_PAGE_SLACK))
    expect(rows.filter(r => r.kind === 'node' && r.id.startsWith('hier:k'))).toHaveLength(
      CHILD_PAGE_SIZE + CHILD_PAGE_SLACK
    )
    expect(rows.some(r => r.kind === 'more')).toBe(false)
  })

  it('leaves the flat Objects folder top level unpaged', () => {
    const all = Array.from({ length: CHILD_PAGE_SIZE + CHILD_PAGE_SLACK + 50 }, (_, i) => obj(`o${i}`))
    const rows = buildTreeRows(
      input({ allObjects: all, expandedNodes: new Set([OBJECTS_FOLDER_ID]) })
    )
    expect(rows.filter(r => r.kind === 'node' && r.id.startsWith('obj:'))).toHaveLength(all.length)
    expect(rows.some(r => r.kind === 'more')).toBe(false)
  })

  it('force-emits a paged-out row on the selection path, after the more row', () => {
    const base = bigFamily(CHILD_PAGE_SIZE + CHILD_PAGE_SLACK + 10)
    const selected = `hier:k${CHILD_PAGE_SIZE + 1}` // beyond the visible page
    const rows = buildTreeRows({ ...base, selectedId: selected })
    const selectedIndex = nodeIndexOf(rows, selected)
    const moreIndex = rows.findIndex(r => r.kind === 'more')
    expect(selectedIndex).toBeGreaterThan(moreIndex)
    // Exactly one page plus the forced row.
    expect(rows.filter(r => r.kind === 'node' && r.id.startsWith('hier:k'))).toHaveLength(
      CHILD_PAGE_SIZE + 1
    )
  })

  it('lists a type from the loaded catalog and force-emits its paged-out selection', () => {
    const kids = Array.from({ length: CHILD_PAGE_SIZE + CHILD_PAGE_SLACK + 10 }, (_, i) => obj(`k${i}`))
    const selected = `obj:k${CHILD_PAGE_SIZE + 1}`
    const rows = buildTreeRows(input({
      namespaces: [{ uri: 'urn:ns', displayName: 'ns' } as Namespace],
      objectTypes: [{ elementId: 'T', displayName: 'T', namespaceUri: 'urn:ns', schema: {} }],
      allObjects: kids,
      catalogObjectsByType: new Map([['T', kids]]),
      objectsByType: new Map([['T', [obj('stale')]]]),
      expandedNodes: new Set([NAMESPACES_FOLDER_ID, 'ns:urn:ns', 'type:T']),
      objectIndex: new Map(kids.map(o => [o.elementId, o])),
      selectedId: selected,
    }))
    expect(nodeIndexOf(rows, 'obj:stale')).toBe(-1)
    expect(nodeIndexOf(rows, selected)).toBeGreaterThan(rows.findIndex(r => r.kind === 'more'))
    expect(rows.filter(r => r.kind === 'node' && r.id.startsWith('obj:k'))).toHaveLength(CHILD_PAGE_SIZE + 1)
  })
})

describe('hierarchy components', () => {
  const parent = obj('parent')
  const ordinary = obj('ordinary', { parentId: 'parent', isComposition: true })
  const secondChild = obj('second-child', { parentId: 'parent' })
  const zulu = obj('zulu', { parentId: 'parent', typeId: 'A', displayName: 'First by name' })
  const beta = obj('beta', { parentId: 'parent', typeId: 'Z', displayName: 'Beta', isComposition: true })
  const alpha = obj('alpha', { parentId: 'parent', typeId: 'Z', displayName: 'Alpha' })
  const children = [zulu, ordinary, beta, secondChild, alpha]
  const base = () => input({
    hierarchicalRoots: [parent],
    allObjects: [parent, ...children],
    objectIndex: new Map([parent, ...children].map(object => [object.elementId, object])),
    childrenByParent: new Map([['parent', children]]),
    hierarchyComponents: new Map([['parent', ['alpha', 'beta', 'zulu']]]),
    objectTypes: [
      { elementId: 'A', displayName: 'Zulu type', namespaceUri: 'urn:ns', schema: {} },
      { elementId: 'Z', displayName: 'Alpha type', namespaceUri: 'urn:ns', schema: {} },
    ],
    expandedNodes: new Set([HIERARCHICAL_FOLDER_ID, 'hier:parent']),
  })
  const directChildren = (rows: TreeRow[]) =>
    rows.filter((row): row is NodeRow => row.kind === 'node' && row.parentIndex === nodeIndexOf(rows, 'hier:parent'))

  it.each([false, true])('orders ordinary children, typed components, then graph groups (toggle %s)', showRelationshipsInTree => {
    const rows = buildTreeRows({
      ...base(),
      showRelationshipsInTree,
      relatedObjects: new Map([['parent', [obj('target', { sourceRelationship: 'Feeds' })]]]),
    })
    expect(directChildren(rows).map(row => row.id)).toEqual([
      'hier:ordinary', 'hier:second-child', 'hier:alpha', 'hier:beta', 'hier:zulu',
      ...(showRelationshipsInTree ? ['relgroup:parent:Feeds'] : []),
    ])
    expect(directChildren(rows).filter(row => row.isComponent).map(row => row.id))
      .toEqual(['hier:alpha', 'hier:beta', 'hier:zulu'])
    expect(children.map(child => child.elementId)).toEqual(['zulu', 'ordinary', 'beta', 'second-child', 'alpha'])
  })

  it('preserves component ordering and badges under filtering', () => {
    const rows = buildTreeRows({ ...base(), filterText: 'a' })
    expect(directChildren(rows).map(row => row.id)).toEqual([
      'hier:ordinary', 'hier:alpha', 'hier:beta', 'hier:zulu',
    ])
    expect(directChildren(rows).filter(row => row.isComponent)).toHaveLength(3)
  })

  it('falls back to type IDs and recognizes contextual HasComponent edges', () => {
    const rows = buildTreeRows({
      ...base(),
      objectTypes: [],
      hierarchyComponents: new Map(),
      childrenByParent: new Map([['parent', children.map(child =>
        ['alpha', 'beta', 'zulu'].includes(child.elementId) ? { ...child, sourceRelationship: 'HasComponent' } : child
      )]]),
    })
    expect(directChildren(rows).map(row => row.id)).toEqual([
      'hier:ordinary', 'hier:second-child', 'hier:zulu', 'hier:alpha', 'hier:beta',
    ])
  })

  it.each([false, true])('merges cross-parent components and deduplicates child/component targets (graph toggle %s)', showRelationshipsInTree => {
    const remote = obj('remote', { parentId: 'elsewhere', sourceRelationship: 'HasComponent' })
    const catalogRemote = { ...remote, sourceRelationship: undefined }
    const rows = buildTreeRows({
      ...base(),
      allObjects: [parent, ...children, catalogRemote],
      objectIndex: new Map([parent, ...children, catalogRemote].map(object => [object.elementId, object])),
      hierarchyComponents: new Map(),
      showRelationshipsInTree,
      relatedObjects: new Map([['parent', [
        { ...ordinary, sourceRelationship: 'HasChildren' },
        { ...alpha, sourceRelationship: 'HasChildren' },
        { ...alpha, sourceRelationship: 'HasComponent' },
        remote,
        remote,
        obj('ancestor', { sourceRelationship: 'HasParent' }),
        obj('owner', { sourceRelationship: 'ComponentOf' }),
        { ...parent, sourceRelationship: 'HasComponent' },
        obj('target', { sourceRelationship: 'Feeds' }),
      ]]]),
    })
    const direct = directChildren(rows)
    expect(direct.filter(row => row.id === 'hier:ordinary')).toHaveLength(1)
    expect(direct.filter(row => row.id === 'hier:alpha')).toHaveLength(1)
    expect(direct.find(row => row.id === 'hier:alpha')).toMatchObject({ isComponent: true, data: alpha })
    expect(direct.filter(row => row.id === 'hier:remote')).toHaveLength(1)
    expect(direct.find(row => row.id === 'hier:remote')).toMatchObject({ isComponent: true, data: catalogRemote })
    expect(rows[nodeIndexOf(rows, 'hier:parent')]).toMatchObject({ count: 6 })
    expect(nodeIndexOf(rows, 'hier:ancestor')).toBe(-1)
    expect(nodeIndexOf(rows, 'hier:owner')).toBe(-1)
    expect(nodeIndexOf(rows, 'relgroup:parent:HasComponent')).toBe(-1)
    expect(nodeIndexOf(rows, 'relgroup:parent:HasChildren')).toBe(-1)
    expect(nodeIndexOf(rows, 'relgroup:parent:Feeds') >= 0).toBe(showRelationshipsInTree)
  })

  it('finds related-only component matches and keeps their composition owners visible', () => {
    const remote = obj('remote', { parentId: 'elsewhere', sourceRelationship: 'HasComponent' })
    const nested = obj('nested-match', { parentId: null, sourceRelationship: 'HasComponent' })
    const rows = buildTreeRows({
      ...base(),
      allObjects: [parent],
      objectIndex: new Map([['parent', parent]]),
      childrenByParent: new Map(),
      hierarchyComponents: new Map(),
      filterText: 'nested-match',
      relatedObjects: new Map([['parent', [remote]], ['remote', [nested]]]),
      expandedNodes: new Set([HIERARCHICAL_FOLDER_ID, 'hier:parent', 'hier:remote']),
    })
    expect(nodeIndexOf(rows, 'hier:parent')).toBeGreaterThan(-1)
    expect(nodeIndexOf(rows, 'hier:remote')).toBeGreaterThan(nodeIndexOf(rows, 'hier:parent'))
    expect(rows[nodeIndexOf(rows, 'hier:nested-match')]).toMatchObject({ isComponent: true })
  })

  it('hides related-only components and their counts independently of graph groups', () => {
    const remote = obj('remote', { parentId: 'elsewhere', sourceRelationship: 'HasComponent' })
    const rows = buildTreeRows({
      ...base(),
      childrenByParent: new Map(),
      hierarchyComponents: new Map(),
      showComponentsInTree: false,
      showRelationshipsInTree: true,
      relatedObjects: new Map([['parent', [remote, obj('target', { sourceRelationship: 'Feeds' })]]]),
    })
    expect(nodeIndexOf(rows, 'hier:remote')).toBe(-1)
    expect(rows[nodeIndexOf(rows, 'hier:parent')]).toMatchObject({ hasChildren: true, count: undefined })
    expect(directChildren(rows).map(row => row.id)).toEqual(['relgroup:parent:Feeds'])
  })

  it('merges outgoing child relationships without turning incoming edges into children', () => {
    const rows = buildTreeRows({
      ...base(),
      childrenByParent: new Map(),
      hierarchyComponents: new Map(),
      relatedObjects: new Map([['parent', [
        obj('child', { sourceRelationship: 'HasChildren' }),
        obj('ancestor', { sourceRelationship: 'HasParent' }),
      ]]]),
    })
    expect(directChildren(rows).map(row => row.id)).toEqual(['hier:child'])
    expect(directChildren(rows)[0].isComponent).toBe(false)
  })

  it('merges components without an edge label without also showing them as graph relationships', () => {
    const remote = obj('remote', { parentId: 'elsewhere' })
    const rows = buildTreeRows({
      ...base(),
      childrenByParent: new Map(),
      hierarchyComponents: new Map([['parent', ['remote']]]),
      showRelationshipsInTree: true,
      relatedObjects: new Map([['parent', [remote, obj('target')]]]),
    })
    expect(directChildren(rows).map(row => row.id)).toEqual(['hier:remote', 'relgroup:parent:Related'])
    expect(rows[nodeIndexOf(rows, 'relgroup:parent:Related')]).toMatchObject({ count: 1 })
  })

  it('guards cycles introduced through cross-parent component edges', () => {
    const remote = obj('remote', { parentId: 'elsewhere', sourceRelationship: 'HasComponent' })
    const rows = buildTreeRows({
      ...base(),
      childrenByParent: new Map(),
      relatedObjects: new Map([['parent', [remote]], ['remote', [{ ...parent, sourceRelationship: 'HasComponent' }]]]),
      expandedNodes: new Set([HIERARCHICAL_FOLDER_ID, 'hier:parent', 'hier:remote']),
    })
    expect(markerMessages(rows)).toContain('(cycle detected)')
  })

  it('paginates and counts unique children when every target is reported by both sources', () => {
    const count = CHILD_PAGE_SIZE + CHILD_PAGE_SLACK + 10
    const many = Array.from({ length: count }, (_, i) =>
      obj(`k${i}`, { parentId: 'parent', displayName: String(i).padStart(4, '0') }))
    const rows = buildTreeRows({
      ...base(),
      hierarchyComponents: new Map(),
      childrenByParent: new Map([['parent', many]]),
      relatedObjects: new Map([['parent', many.map(object => ({ ...object, sourceRelationship: 'HasComponent' }))]]),
      selectedId: `hier:k${count - 1}`,
    })
    expect(rows[nodeIndexOf(rows, 'hier:parent')]).toMatchObject({ count })
    expect(directChildren(rows)).toHaveLength(CHILD_PAGE_SIZE + 1)
    expect(rows.find(row => row.kind === 'more')).toMatchObject({
      shown: CHILD_PAGE_SIZE, hidden: count - CHILD_PAGE_SIZE,
    })
    expect(rows[nodeIndexOf(rows, `hier:k${count - 1}`)]).toMatchObject({ isComponent: true })
  })

  it.each(['', 'alpha'])('hides component subtrees even during search or selected-row reveal (%s)', filterText => {
    const descendant = obj('descendant', { parentId: 'alpha' })
    const rows = buildTreeRows({
      ...base(),
      showComponentsInTree: false,
      showRelationshipsInTree: true,
      filterText,
      selectedId: 'hier:alpha',
      childrenByParent: new Map([['parent', children], ['alpha', [descendant]]]),
      expandedNodes: new Set([HIERARCHICAL_FOLDER_ID, 'hier:parent', 'hier:alpha']),
      relatedObjects: new Map([['parent', [obj('target', { sourceRelationship: 'Feeds' })]]]),
    })
    for (const hidden of ['alpha', 'beta', 'zulu', 'descendant']) {
      expect(nodeIndexOf(rows, `hier:${hidden}`)).toBe(-1)
    }
    expect(rows[nodeIndexOf(rows, 'hier:parent')]).toMatchObject({ count: 2, hasChildren: true })
    if (!filterText) {
      expect(directChildren(rows).map(row => row.id)).toEqual([
        'hier:ordinary', 'hier:second-child', 'relgroup:parent:Feeds',
      ])
    }
  })

  it('removes the child count and chevron when a parent has only hidden components', () => {
    const rows = buildTreeRows({
      ...base(),
      showComponentsInTree: false,
      childrenByParent: new Map([['parent', [alpha, beta, zulu]]]),
    })
    expect(rows[nodeIndexOf(rows, 'hier:parent')]).toMatchObject({ count: undefined, hasChildren: false })
    expect(directChildren(rows)).toEqual([])
  })

  it('pages the ordered list and retains a selected component beyond the page', () => {
    const ordinaryChildren = Array.from({ length: CHILD_PAGE_SIZE + CHILD_PAGE_SLACK + 1 }, (_, i) =>
      obj(`ordinary${i}`, { parentId: 'parent' }))
    const rows = buildTreeRows({
      ...base(),
      childrenByParent: new Map([['parent', [alpha, ...ordinaryChildren]]]),
      selectedId: 'hier:alpha',
    })
    const visible = directChildren(rows)
    expect(visible).toHaveLength(CHILD_PAGE_SIZE + 1)
    expect(visible[0].id).toBe('hier:ordinary0')
    expect(visible[visible.length - 1]).toMatchObject({ id: 'hier:alpha', isComponent: true })
    expect(nodeIndexOf(rows, 'hier:alpha')).toBeGreaterThan(rows.findIndex(row => row.kind === 'more'))
  })

  it('retains all resolved edges, records component membership, and refreshes them', async () => {
    const client = createClient('http://server')
    const fetch = vi.spyOn(client, 'getRelatedObjectsBatch').mockResolvedValue({ related: new Map([['parent', [
      { ...alpha, sourceRelationship: 'HasComponent' },
      { ...ordinary, sourceRelationship: 'HasChildren' },
      obj('target', { sourceRelationship: 'Feeds' }),
      obj('ancestor', { sourceRelationship: 'HasParent' }),
      { ...parent, sourceRelationship: 'HasComponent' },
    ]]]), failures: [] })
    await resolveRelationshipGroups(client, [parent])
    expect(useExplorerStore.getState().hierarchyComponents.get('parent')).toEqual(['alpha'])
    expect(useExplorerStore.getState().relatedObjects.get('parent')?.map(object => object.elementId))
      .toEqual(['alpha', 'ordinary', 'target', 'ancestor', 'parent'])
    await resolveRelationshipGroups(client, [parent])
    expect(fetch).toHaveBeenCalledOnce()
    fetch.mockResolvedValue({ related: new Map([['parent', []]]), failures: [] })
    await resolveRelationshipGroups(client, [parent], true)
    expect(useExplorerStore.getState().hierarchyComponents.get('parent')).toEqual([])
    useExplorerStore.getState().reset()
    expect(useExplorerStore.getState().hierarchyComponents.size).toBe(0)
  })

  it('records a failed element without caching it as resolved, and clears it on a later success', async () => {
    const client = createClient('http://server')
    const fetch = vi.spyOn(client, 'getRelatedObjectsBatch').mockResolvedValue({
      related: new Map(),
      failures: [{ elementId: 'parent', message: 'HTTP 500: backend down' }],
    })
    await resolveRelationshipGroups(client, [parent])
    expect(useExplorerStore.getState().relationshipErrors.get('parent')).toBe('HTTP 500: backend down')
    expect(useExplorerStore.getState().compositionErrors.has('parent')).toBe(false)
    expect(useExplorerStore.getState().relatedObjects.has('parent')).toBe(false)
    // Not retried by the lazy resolver; a forced refresh retries it.
    await resolveRelationshipGroups(client, [parent])
    expect(fetch).toHaveBeenCalledOnce()
    fetch.mockResolvedValue({ related: new Map([['parent', []]]), failures: [] })
    await resolveRelationshipGroups(client, [parent], true)
    expect(useExplorerStore.getState().relationshipErrors.has('parent')).toBe(false)
  })

  it('records a whole-batch failure so scrolling does not re-request it', async () => {
    const client = createClient('http://server')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetch = vi.spyOn(client, 'getRelatedObjectsBatch').mockRejectedValue(new Error('HTTP 503: busy'))
    await resolveRelationshipGroups(client, [parent])
    expect(error).toHaveBeenCalled()
    expect(useExplorerStore.getState().relationshipErrors.get('parent')).toBe('HTTP 503: busy')
    await resolveRelationshipGroups(client, [parent])
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('retries a failed hierarchy row when it is expanded', async () => {
    const client = createClient('http://server')
    const fetch = vi.spyOn(client, 'getRelatedObjectsBatch')
      .mockResolvedValue({ related: new Map([['parent', []]]), failures: [] })
    useExplorerStore.getState().setRelationshipErrors([['parent', 'HTTP 500: backend down']])
    await loadChildrenFor({
      kind: 'node', key: 'hier:parent', id: 'hier:parent', nodeType: 'object', label: 'parent', data: parent,
      depth: 1, hasChildren: true, isExpanded: false, parentIndex: -1,
    } as NodeRow)
    expect(fetch).toHaveBeenCalledOnce()
    expect(useExplorerStore.getState().relationshipErrors.has('parent')).toBe(false)
  })

  it('logs failed resolution without caching empty success results', async () => {
    const client = createClient('http://server')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(client, 'getRelatedObjectsBatch').mockRejectedValue(new Error('offline'))
    await resolveRelationshipGroups(client, [parent])
    expect(error).toHaveBeenCalled()
    expect(useExplorerStore.getState().hierarchyComponents.has('parent')).toBe(false)
    expect(useExplorerStore.getState().relatedObjects.has('parent')).toBe(false)
  })
})

describe('buildTreeRows: parentIndex chains', () => {
  it('points every row at the row it was emitted under', () => {
    const A = obj('A')
    const B = obj('B', { parentId: 'A' })
    const rows = buildTreeRows(
      input({
        hierarchicalRoots: [A],
        childrenByParent: new Map([['A', [B]]]),
        expandedNodes: new Set([HIERARCHICAL_FOLDER_ID, 'hier:A']),
      })
    )
    const folderIndex = nodeIndexOf(rows, HIERARCHICAL_FOLDER_ID)
    const aIndex = nodeIndexOf(rows, 'hier:A')
    const bIndex = nodeIndexOf(rows, 'hier:B')
    expect(rows[folderIndex].parentIndex).toBe(-1)
    expect(rows[aIndex].parentIndex).toBe(folderIndex)
    expect(rows[bIndex].parentIndex).toBe(aIndex)
  })
})

describe('buildTreeRows: relationship types in namespaces', () => {
  it('shows relationship types under their namespace with inverse direction', () => {
    const namespace: Namespace = {
      uri: 'urn:test',
      displayName: 'test',
    }

    const contains: RelationshipType = {
      elementId: 'rel-contains',
      displayName: 'Contains',
      namespaceUri: 'urn:test',
      reverseOf: 'rel-contained-by',
    }

    const containedBy: RelationshipType = {
      elementId: 'rel-contained-by',
      displayName: 'Contained By',
      namespaceUri: 'urn:test',
      reverseOf: 'rel-contains',
    }

    const rows = buildTreeRows(
      input({
        namespaces: [namespace],
        relationshipTypes: [contains, containedBy],
        expandedNodes: new Set([
          NAMESPACES_FOLDER_ID,
          'ns:urn:test',
        ]),
      })
    )

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeType: 'relationshipType',
          label: 'Contains → Contained By',
        }),
      ])
    )
  })

  it('includes relationship types in the namespace count', () => {
    const namespace: Namespace = {
      uri: 'urn:test',
      displayName: 'test',
    }

    const relationship: RelationshipType = {
      elementId: 'rel-feeds',
      displayName: 'Feeds',
      namespaceUri: 'urn:test',
      reverseOf: 'rel-fed-by',
    }

    const rows = buildTreeRows(
      input({
        namespaces: [namespace],
        relationshipTypes: [relationship],
        expandedNodes: new Set([NAMESPACES_FOLDER_ID]),
      })
    )

    const namespaceRow = rows.find(
      r => r.kind === 'node' && r.id === 'ns:urn:test'
    ) as NodeRow | undefined

    expect(namespaceRow).toBeDefined()
    expect(namespaceRow!.count).toBe(1)
  })

  it('keeps the namespace visible when filtering by relationship type name', () => {
    const namespace: Namespace = {
      uri: 'urn:test',
      displayName: 'test',
    }

    const relationship: RelationshipType = {
      elementId: 'rel-monitors',
      displayName: 'Monitors',
      namespaceUri: 'urn:test',
      reverseOf: 'rel-monitored-by',
    }

    const rows = buildTreeRows(
      input({
        namespaces: [namespace],
        relationshipTypes: [relationship],
        expandedNodes: new Set([
          NAMESPACES_FOLDER_ID,
          'ns:urn:test',
        ]),
        filterText: 'monitors',
      })
    )

    expect(rows.some(r => r.kind === 'node' && r.id === 'ns:urn:test')).toBe(true)
    expect(
      rows.some(
        r =>
          r.kind === 'node' &&
          r.nodeType === 'relationshipType' &&
          r.label.includes('Monitors')
      )
    ).toBe(true)
  })

  const feeds: RelationshipType = {
    elementId: 'ns:Feeds',
    displayName: 'Feeds',
    namespaceUri: 'urn:test',
    reverseOf: 'ns:FedBy',
  }
  const feedsInput = (over: Partial<TreeBuildInput> = {}) => input({
    namespaces: [{ uri: 'urn:test', displayName: 'test' }],
    relationshipTypes: [feeds],
    relationshipInstances: new Map([['ns:Feeds', {
      instances: [
        { source: obj('pump'), targets: [obj('tank'), obj('valve')] },
        { source: obj('mixer'), targets: [obj('oven')] },
      ],
    }]]),
    ...over,
  })

  it('lists the source objects of an expanded relationship type, and their targets', () => {
    const pumpId = relationshipSourceRowId('ns:Feeds', 'pump')
    const rows = buildTreeRows(feedsInput({
      expandedNodes: new Set([NAMESPACES_FOLDER_ID, 'ns:urn:test', 'reltype:ns:Feeds', pumpId]),
    }))
    const relIndex = nodeIndexOf(rows, 'reltype:ns:Feeds')
    expect(rows[relIndex]).toMatchObject({ hasChildren: true, count: 2 })
    const pumpIndex = nodeIndexOf(rows, pumpId)
    expect(rows[pumpIndex]).toMatchObject({ nodeType: 'object', parentIndex: relIndex, count: 2 })
    expect(rows[nodeIndexOf(rows, 'obj:tank')].parentIndex).toBe(pumpIndex)
    expect(rows[nodeIndexOf(rows, 'obj:valve')].parentIndex).toBe(pumpIndex)
    expect(nodeIndexOf(rows, relationshipSourceRowId('ns:Feeds', 'mixer'))).toBeGreaterThan(-1)
    expect(nodeIndexOf(rows, 'obj:oven')).toBe(-1)
  })

  it('filters relationship sources by source or target match', () => {
    const rows = buildTreeRows(feedsInput({
      expandedNodes: new Set([NAMESPACES_FOLDER_ID, 'ns:urn:test', 'reltype:ns:Feeds']),
      filterText: 'feeds',
    }))
    expect(markerMessages(rows)).toContain('No matching objects')

    const ovenRows = buildTreeRows(feedsInput({
      relationshipTypes: [{ ...feeds, displayName: 'oven feeds' }],
      expandedNodes: new Set([NAMESPACES_FOLDER_ID, 'ns:urn:test', 'reltype:ns:Feeds']),
      filterText: 'oven',
    }))
    expect(nodeIndexOf(ovenRows, relationshipSourceRowId('ns:Feeds', 'mixer'))).toBeGreaterThan(-1)
    expect(nodeIndexOf(ovenRows, relationshipSourceRowId('ns:Feeds', 'pump'))).toBe(-1)
  })

  it('shows a marker when the relationship type failed to load', () => {
    const rows = buildTreeRows(feedsInput({
      relationshipInstances: new Map([['ns:Feeds', { instances: [], error: 'HTTP 404' }]]),
      expandedNodes: new Set([NAMESPACES_FOLDER_ID, 'ns:urn:test', 'reltype:ns:Feeds']),
    }))
    expect(markerMessages(rows)).toContain('(failed to load: HTTP 404)')
  })

  it('shows failed sources alongside the ones that loaded', () => {
    const rows = buildTreeRows(feedsInput({
      relationshipInstances: new Map([['ns:Feeds', {
        instances: [{ source: obj('pump'), targets: [obj('tank')] }],
        failures: [{ elementId: 'mixer', message: 'HTTP 500: down' }, { elementId: 'oven', message: 'HTTP 500: down' }],
      }]]),
      expandedNodes: new Set([NAMESPACES_FOLDER_ID, 'ns:urn:test', 'reltype:ns:Feeds']),
    }))
    expect(markerMessages(rows)).toContain('(failed to load mixer: HTTP 500: down (+1 more))')
    expect(nodeIndexOf(rows, relationshipSourceRowId('ns:Feeds', 'pump'))).toBeGreaterThan(-1)
  })

  it('shows why an expanded hierarchy object could not load its relationships', () => {
    const A = obj('A')
    const rows = buildTreeRows(input({
      hierarchicalRoots: [A],
      expandedNodes: new Set([HIERARCHICAL_FOLDER_ID, 'hier:A']),
      relationshipErrors: new Map([['A', 'HTTP 500: down']]),
    }))
    expect(rows[nodeIndexOf(rows, 'hier:A')]).toMatchObject({ hasChildren: true })
    expect(markerMessages(rows)).toContain('(failed to load relationships: HTTP 500: down)')
  })

  it('keeps the two lookups apart: a relationship error gives a plain object no chevron', () => {
    const A = obj('A')
    const rows = buildTreeRows(input({
      allObjects: [A],
      expandedNodes: new Set([OBJECTS_FOLDER_ID, 'obj:A']),
      relationshipErrors: new Map([['A', 'HTTP 500: down']]),
    }))
    expect(rows[nodeIndexOf(rows, 'obj:A')]).toMatchObject({ hasChildren: false })
    expect(markerMessages(rows).some(message => message.includes('failed to load'))).toBe(false)
  })
})

describe('isHierarchicalRelationship', () => {
  it('treats parent/child bucket relationship types as hierarchical', () => {
    expect(isHierarchicalRelationship('HasParent')).toBe(true)
    expect(isHierarchicalRelationship('ComponentOf')).toBe(true)
    expect(isHierarchicalRelationship('HasChildren')).toBe(true)
    expect(isHierarchicalRelationship('HasComponent')).toBe(true)
    expect(isHierarchicalRelationship('InheritedBy')).toBe(true)
  })

  it('treats everything else, including undefined, as non-hierarchical', () => {
    expect(isHierarchicalRelationship('Feeds')).toBe(false)
    expect(isHierarchicalRelationship('MonitoredBy')).toBe(false)
    expect(isHierarchicalRelationship(undefined)).toBe(false)
  })
})

describe('groupRelatedObjects', () => {
  it('groups by sourceRelationship, alphabetically, and sorts members by label', () => {
    const a = obj('a', { displayName: 'Zebra', sourceRelationship: 'Feeds' })
    const b = obj('b', { displayName: 'Apple', sourceRelationship: 'Feeds' })
    const c = obj('c', { displayName: 'Only', sourceRelationship: 'MonitoredBy' })
    const groups = groupRelatedObjects([a, b, c])
    expect([...groups.keys()]).toEqual(['Feeds', 'MonitoredBy'])
    expect(groups.get('Feeds')!.map(o => o.elementId)).toEqual(['b', 'a']) // Apple before Zebra
    expect(groups.get('MonitoredBy')).toHaveLength(1)
  })

  it('falls back to "Related" when sourceRelationship is missing', () => {
    const a = obj('a')
    const groups = groupRelatedObjects([a])
    expect([...groups.keys()]).toEqual(['Related'])
  })
})

describe('buildTreeRows: relationship groups in the Hierarchy walk', () => {
  it('does nothing when showRelationshipsInTree is off', () => {
    const A = obj('A')
    const related = obj('R', { sourceRelationship: 'Feeds' })
    const rows = buildTreeRows(
      input({
        hierarchicalRoots: [A],
        expandedNodes: new Set([HIERARCHICAL_FOLDER_ID, 'hier:A']),
        showRelationshipsInTree: false,
        relatedObjects: new Map([['A', [related]]]),
      })
    )
    expect(rows.some(r => r.kind === 'node' && r.nodeType === 'relationshipGroup')).toBe(false)
  })

  it('does nothing while a filter is active, even if the toggle is on', () => {
    const A = obj('A')
    const related = obj('R', { sourceRelationship: 'Feeds' })
    const rows = buildTreeRows(
      input({
        hierarchicalRoots: [A],
        expandedNodes: new Set([HIERARCHICAL_FOLDER_ID, 'hier:A']),
        showRelationshipsInTree: true,
        relatedObjects: new Map([['A', [related]]]),
        filterText: 'a',
        objectIndex: new Map([['A', A]]),
        searchIndex: new Map([['A', 'a']]),
      })
    )
    expect(rows.some(r => r.kind === 'node' && r.nodeType === 'relationshipGroup')).toBe(false)
  })

  it('emits a relationshipGroup row per relationship type, nested under the object', () => {
    const A = obj('A')
    const feedsTarget = obj('R1', { sourceRelationship: 'Feeds' })
    const monitoredTarget = obj('R2', { sourceRelationship: 'MonitoredBy' })
    const rows = buildTreeRows(
      input({
        hierarchicalRoots: [A],
        expandedNodes: new Set([
          HIERARCHICAL_FOLDER_ID,
          'hier:A',
          'relgroup:A:Feeds',
          'relgroup:A:MonitoredBy',
        ]),
        showRelationshipsInTree: true,
        relatedObjects: new Map([['A', [feedsTarget, monitoredTarget]]]),
      })
    )
    const feedsGroup = rows.find(
      r => r.kind === 'node' && r.id === 'relgroup:A:Feeds'
    ) as NodeRow | undefined
    expect(feedsGroup).toBeDefined()
    expect(feedsGroup!.nodeType).toBe('relationshipGroup')
    expect(feedsGroup!.relationshipType).toBe('Feeds')
    expect(feedsGroup!.relationshipParentId).toBe('A')
    expect(feedsGroup!.count).toBe(1)

    // Related element rows reuse the hier: id scheme, unifying with the object's
    // normal hierarchy identity rather than a distinct relationship-only id.
    const relatedRow = rows.find(r => r.kind === 'node' && r.id === 'hier:R1')
    expect(relatedRow).toBeDefined()
    expect(relatedRow!.parentIndex).toBe(rows.indexOf(feedsGroup!))
  })
})
