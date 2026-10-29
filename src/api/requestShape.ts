/**
 * A declarative description of a single i3X HTTP request: method, path, query,
 * and body. It is the single source of truth the code-sample panel renders
 * from, so a snippet can never drift from the call the client actually makes.
 * Each builder below mirrors, exactly, the matching I3XClient method.
 */
export interface RequestDescriptor {
  /** Client method this mirrors, e.g. 'getValue'. Stable id, not shown. */
  operation: string
  /** Human title for the panel header, e.g. 'Get current value'. */
  title: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** Path only, no host, no leading query. Includes any `/v1` the base carries. */
  path: string
  /** Query params as string pairs (already what would go on the wire). */
  query?: Record<string, string>
  /** Request body object, serialized per target language by the renderers. */
  body?: unknown
  /**
   * A one-line caveat worth surfacing next to the sample, usually a quirk the
   * reader would otherwise get wrong (moved id, recursion depth).
   */
  note?: string
}

/**
 * GET /namespaces — list every namespace. (The response wraps the array in
 * {success, result}, which is a response concern, not a request one.)
 */
export function describeGetNamespaces(includeMetadata = true): RequestDescriptor {
  return {
    operation: 'getNamespaces',
    title: 'List namespaces',
    method: 'GET',
    path: '/namespaces',
    query: { includeMetadata: String(includeMetadata) },
  }
}

/** GET /objecttypes — list object types, optionally scoped to one namespace. */
export function describeGetObjectTypes(
  namespaceUri: string | undefined,
  includeMetadata = true
): RequestDescriptor {
  const query: Record<string, string> = { includeMetadata: String(includeMetadata) }
  if (namespaceUri) query.namespaceUri = namespaceUri
  return {
    operation: 'getObjectTypes',
    title: 'List object types',
    method: 'GET',
    path: '/objecttypes',
    query,
  }
}

/** GET /relationshiptypes — list relationship types, optionally scoped to one namespace. */
export function describeGetRelationshipTypes(
  namespaceUri: string | undefined,
  includeMetadata = true
): RequestDescriptor {
  const query: Record<string, string> = { includeMetadata: String(includeMetadata) }
  if (namespaceUri) query.namespaceUri = namespaceUri
  return {
    operation: 'getRelationshipTypes',
    title: 'List relationship types',
    method: 'GET',
    path: '/relationshiptypes',
    query,
  }
}

/** GET /objects — list instances of a type. */
export function describeGetObjects(
  typeId: string | undefined,
  includeMetadata = false,
  rootsOnly = false,
  lean = false
): RequestDescriptor {
  const query: Record<string, string> = {}
  if (typeId) query.typeElementId = typeId
  // Ask for metadata so namespaceUri is present on each object, unless the
  // caller is `lean` and resolves namespaceUri from the object types itself.
  query.includeMetadata = String(!lean ? true : includeMetadata)
  if (rootsOnly) query.root = 'true'
  return {
    operation: 'getObjects',
    title: 'List objects of a type',
    method: 'GET',
    path: '/objects',
    query,
  }
}

/**
 * Fetch one object by id. There is no GET /objects/{id}: a single object is
 * read with a bulk POST /objects/list and a single-element array.
 */
export function describeGetObject(elementId: string): RequestDescriptor {
  return {
    operation: 'getObject',
    title: 'Get object',
    method: 'POST',
    path: '/objects/list',
    body: { elementIds: [elementId], includeMetadata: true },
    note: 'There is no GET /objects/{id}; a single object is read via the bulk list.',
  }
}

/** POST /objects/value — last known value(s). maxDepth walks composition. */
export function describeGetValue(
  elementId: string,
  maxDepth: number
): RequestDescriptor {
  return {
    operation: 'getValue',
    title: 'Get current value',
    method: 'POST',
    path: '/objects/value',
    body: { elementIds: [elementId], maxDepth },
    note:
      maxDepth === 0
        ? 'maxDepth 0 recurses the whole composition tree (HasComponent).'
        : undefined,
  }
}

/** POST /objects/history — historical values over a time window. */
export function describeGetHistory(
  elementId: string,
  startTime: string | undefined,
  endTime: string | undefined,
  maxDepth: number
): RequestDescriptor {
  const body: Record<string, unknown> = { elementIds: [elementId], maxDepth }
  if (startTime) body.startTime = startTime
  if (endTime) body.endTime = endTime
  return {
    operation: 'getHistory',
    title: 'Get history',
    method: 'POST',
    path: '/objects/history',
    body,
  }
}

/** POST /objects/related — objects related to one element. */
export function describeGetRelatedObjects(
  elementId: string,
  relationshipType: string | undefined
): RequestDescriptor {
  return {
    operation: 'getRelatedObjects',
    title: 'Get related objects',
    method: 'POST',
    path: '/objects/related',
    body: {
      elementIds: [elementId],
      ...(relationshipType ? { relationshipType } : {}),
      includeMetadata: true,
    },
  }
}
