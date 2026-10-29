/**
 * Clipboard helpers shared by every context menu.
 *
 * `navigator.clipboard` is undefined in an insecure context and rejects when the
 * document isn't focused, neither of which is worth an error dialog over a copy
 * action, so both failures are swallowed.
 */

export function copyText(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {})
}

export function copyJson(value: unknown) {
  copyText(JSON.stringify(value, null, 2))
}

/** Copies text built asynchronously (e.g. JSON assembled by the catalog engine). */
export function copyTextFrom(text: Promise<string>) {
  text.then(copyText).catch(err => console.warn('Copy failed:', err))
}
