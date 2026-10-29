/**
 * The smallest possible stand-in for browser layout, for the handful of jsdom
 * component tests in this repo.
 *
 * jsdom computes no layout, so `offsetHeight` is always 0 and there is no
 * ResizeObserver. That matters here because every virtualized list measures its
 * scroll container and renders nothing when it measures zero, which is exactly
 * the bug these tests guard (see WindowedList.tsx's height contract). Rather
 * than pretend to implement CSS, this emulates two facts and stops:
 *
 *   1. a scroll container bounded only by max-height is as tall as its content,
 *      capped at that maximum
 *   2. a rendered row is one row tall
 *
 * Anything else still measures 0, as jsdom would.
 */

/** Stands in for the callers' max-h-80 / max-h-[32rem] bounds. */
export const TEST_MAX_HEIGHT = 320
export const TEST_ROW_HEIGHT = 40

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

export function installJsdomLayout(): void {
  globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver

  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }
  Element.prototype.scrollIntoView ??= function scrollIntoView() {}

  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement): number {
      if (this.hasAttribute('data-index')) return TEST_ROW_HEIGHT
      if (this.hasAttribute('data-windowed-list')) {
        const spacer = this.firstElementChild as HTMLElement | null
        const content = spacer ? parseFloat(spacer.style.minHeight || '0') : 0
        return Math.min(TEST_MAX_HEIGHT, Number.isNaN(content) ? 0 : content)
      }
      return 0
    },
  })
}
