type Structured = Record<string, unknown> | unknown[]

/** Most changed paths reported for one update; the rest are summarized as a count. */
export const MAX_CHANGED_PATHS = 20

/**
 * Decodes a JSON object or array that a server delivered as a *string*. Returns
 * undefined for anything else, so scalars and plain text stay text.
 */
export function parseJsonStructure(v: unknown): Structured | undefined {
  if (typeof v !== 'string') return undefined
  const trimmed = v.trim()
  if (trimmed[0] !== '{' && trimmed[0] !== '[') return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return parsed !== null && typeof parsed === 'object' ? (parsed as Structured) : undefined
  } catch {
    return undefined
  }
}

/** The value as an object or array (decoding a JSON string), or undefined for a scalar. */
export function asStructured(v: unknown): Structured | undefined {
  if (v !== null && typeof v === 'object') return v as Structured
  return parseJsonStructure(v)
}

/** "{…} 3 fields" / "[…] 12 items". */
export function describeStructure(v: Structured): string {
  if (Array.isArray(v)) return `[…] ${v.length} item${v.length === 1 ? '' : 's'}`
  const count = Object.keys(v).length
  return `{…} ${count} field${count === 1 ? '' : 's'}`
}

/**
 * One leaf that differs between two values. `before`/`after` are undefined when
 * the leaf was added or removed.
 */
export interface ValueChange {
  /** `motor.speed`, `readings[2]`, or `(value)` for a scalar. */
  path: string
  before: unknown
  after: unknown
}

/**
 * The leaves that differ between two values, in document order and capped at
 * `limit`. Empty when they are deeply equal. Key order never counts as a change,
 * and a JSON string compares by its content.
 */
export function diffValues(previous: unknown, next: unknown, limit = MAX_CHANGED_PATHS): ValueChange[] {
  const changes: ValueChange[] = []

  const walk = (a: unknown, b: unknown, path: string) => {
    if (changes.length >= limit || Object.is(a, b)) return
    const bothArrays = Array.isArray(a) && Array.isArray(b)
    const bothObjects =
      a !== null && b !== null && typeof a === 'object' && typeof b === 'object' &&
      !Array.isArray(a) && !Array.isArray(b)
    if (!bothArrays && !bothObjects) {
      changes.push({ path: path || '(value)', before: a, after: b })
      return
    }
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const child = bothArrays ? `${path}[${key}]` : path ? `${path}.${key}` : key
      walk(left[key], right[key], child)
    }
  }

  walk(asStructured(previous) ?? previous, asStructured(next) ?? next, '')
  return changes
}

/** The value as a finite number (numeric strings included), or undefined; "1A0" is not a number. */
export function toFiniteNumber(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : undefined
}

/** `after - before` when both read as finite numbers (numeric strings included). */
export function numericDelta(before: unknown, after: unknown): number | undefined {
  const a = toFiniteNumber(before)
  const b = toFiniteNumber(after)
  return a !== undefined && b !== undefined ? b - a : undefined
}
