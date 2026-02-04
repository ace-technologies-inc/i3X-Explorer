# Bug Report: Server incorrectly parses elementId prefix as dataset name

## Summary

The I3X server at `demo.timebase.cloud:4512` incorrectly interprets client-side elementId prefixes as dataset names, causing history queries to fail with "Dataset not found" errors.

## Environment

- **Server**: https://demo.timebase.cloud:4512/i3x
- **Client**: i3X Explorer v0.1.3
- **Endpoint**: `POST /objects/history`

## Steps to Reproduce

1. Send a history query with an elementId that contains a colon-separated prefix:

```bash
curl -X POST "https://demo.timebase.cloud:4512/i3x/objects/history" \
  -H "Content-Type: application/json" \
  -d '{
    "elementIds": ["hier:Solar Demo"],
    "startTime": "2026-02-03T19:00:00Z",
    "endTime": "2026-02-03T21:00:00Z"
  }'
```

## Expected Behavior

The server should return a 404 or appropriate error indicating that no object exists with the elementId `hier:Solar Demo`.

## Actual Behavior

The server returns:
```
404: Dataset not found: hier
```

The server appears to be parsing the elementId by splitting on `:` and interpreting the first segment (`hier`) as a dataset name, rather than treating the entire string as an opaque identifier.

## Root Cause Analysis

The server seems to assume all elementIds follow the pattern `{dataset}:{tag}` and extracts the dataset name by splitting on the first colon. This breaks when:

1. Client applications use prefixed IDs for internal tracking (e.g., `hier:` for hierarchical view items)
2. ElementIds legitimately contain colons in unexpected positions
3. ElementIds don't follow the `dataset:tag` convention

## Workaround

The client now strips known prefixes before sending requests to the server. This is not ideal as:

- It requires the client to know about server-side parsing behavior
- It may mask legitimate elementId lookup failures
- Other clients will encounter the same issue

## Suggested Fix

The server should treat elementIds as opaque strings and look them up directly in the object registry, rather than parsing them to extract dataset information. If an elementId doesn't exist, return a clear error like "Object not found: {elementId}" rather than attempting to parse and failing on a derived value.

## Additional Context

Valid elementIds on this server follow the pattern:
- `Solar Demo` (dataset)
- `Solar Demo:INV07.Panel Temperature` (tag)

The working query:
```bash
curl -X POST "https://demo.timebase.cloud:4512/i3x/objects/history" \
  -H "Content-Type: application/json" \
  -d '{
    "elementIds": ["Solar Demo:INV07.Panel Temperature"],
    "startTime": "2026-02-03T19:00:00Z",
    "endTime": "2026-02-03T21:00:00Z"
  }'
```

Returns data successfully.
