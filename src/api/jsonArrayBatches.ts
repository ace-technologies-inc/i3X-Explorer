const QUOTE = 0x22
const BACKSLASH = 0x5c
const COMMA = 0x2c
const COLON = 0x3a
const OPEN_BRACE = 0x7b
const CLOSE_BRACE = 0x7d
const OPEN_BRACKET = 0x5b
const CLOSE_BRACKET = 0x5d

/** Where the array sits in the body: the body itself, or the `result` member of a top-level object. */
export type JsonArrayLocation = 'root' | 'result'

function isWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09
}

function skipWhitespace(bytes: Uint8Array, position: number): number {
  while (position < bytes.length && isWhitespace(bytes[position])) position++
  return position
}

/** The position just past the string that opens at `position`. */
function skipString(bytes: Uint8Array, position: number): number {
  position++
  while (position < bytes.length) {
    const byte = bytes[position]
    if (byte === BACKSLASH) position += 2
    else if (byte === QUOTE) return position + 1
    else position++
  }
  throw new SyntaxError('Unterminated string in JSON body')
}

/** The position just past the value that starts at `position`. */
function skipValue(bytes: Uint8Array, position: number): number {
  const first = bytes[position]
  if (first === QUOTE) return skipString(bytes, position)
  if (first !== OPEN_BRACE && first !== OPEN_BRACKET) {
    while (position < bytes.length) {
      const byte = bytes[position]
      if (byte === COMMA || byte === CLOSE_BRACE || byte === CLOSE_BRACKET || isWhitespace(byte)) break
      position++
    }
    return position
  }
  let depth = 0
  while (position < bytes.length) {
    const byte = bytes[position]
    if (byte === QUOTE) {
      position = skipString(bytes, position)
      continue
    }
    if (byte === OPEN_BRACE || byte === OPEN_BRACKET) depth++
    else if (byte === CLOSE_BRACE || byte === CLOSE_BRACKET) {
      depth--
      if (depth === 0) return position + 1
    }
    position++
  }
  throw new SyntaxError('Unexpected end of JSON body')
}

/** The position of the `[` opening the `result` member, or -1 when there is no array there. */
function findResultArray(bytes: Uint8Array, start: number): number {
  const decoder = new TextDecoder()
  let position = skipWhitespace(bytes, start + 1)
  while (position < bytes.length && bytes[position] !== CLOSE_BRACE) {
    if (bytes[position] !== QUOTE) throw new SyntaxError('Expected a member name in JSON body')
    const keyEnd = skipString(bytes, position)
    const key = decoder.decode(bytes.subarray(position + 1, keyEnd - 1))
    position = skipWhitespace(bytes, keyEnd)
    if (bytes[position] !== COLON) throw new SyntaxError('Expected ":" in JSON body')
    position = skipWhitespace(bytes, position + 1)
    if (key === 'result') return bytes[position] === OPEN_BRACKET ? position : -1
    position = skipWhitespace(bytes, skipValue(bytes, position))
    if (bytes[position] === COMMA) position = skipWhitespace(bytes, position + 1)
  }
  return -1
}

/**
 * Parses a JSON array a batch of elements at a time, so a body larger than the
 * engine's maximum string length still parses. Returns null when the body has
 * no array at `location`.
 */
export function parseJsonArrayInBatches(
  buffer: ArrayBuffer,
  location: JsonArrayLocation,
  batchBytes: number
): unknown[] | null {
  const bytes = new Uint8Array(buffer)
  const decoder = new TextDecoder()
  const start = skipWhitespace(bytes, 0)
  const open = location === 'root'
    ? (bytes[start] === OPEN_BRACKET ? start : -1)
    : (bytes[start] === OPEN_BRACE ? findResultArray(bytes, start) : -1)
  if (open < 0) return null

  const items: unknown[] = []
  let position = skipWhitespace(bytes, open + 1)
  let batchStart = position
  const flush = (end: number) => {
    if (end <= batchStart) return
    const batch = JSON.parse(`[${decoder.decode(bytes.subarray(batchStart, end))}]`) as unknown[]
    for (const item of batch) items.push(item)
  }
  while (position < bytes.length && bytes[position] !== CLOSE_BRACKET) {
    const end = skipValue(bytes, position)
    if (end - batchStart >= batchBytes) {
      flush(end)
      position = skipWhitespace(bytes, end)
      if (bytes[position] === COMMA) position = skipWhitespace(bytes, position + 1)
      batchStart = position
      continue
    }
    position = skipWhitespace(bytes, end)
    if (bytes[position] === COMMA) position = skipWhitespace(bytes, position + 1)
  }
  if (position >= bytes.length) throw new SyntaxError('Unexpected end of JSON body')
  flush(position)
  return items
}
