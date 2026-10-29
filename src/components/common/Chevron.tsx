/**
 * The one disclosure marker in the app.
 *
 * There used to be three: `›`/`⌄` in the tree (two different glyphs at two
 * different optical baselines, so the mark visibly jumped when a node opened),
 * a `▶` in the Overview tab, and another in the relationships list. A drawn
 * chevron rotates rather than swaps, so open/closed is one shape in two
 * positions, and it sits on the text baseline the same way everywhere.
 *
 * Two ways to drive it, because the app toggles disclosures both ways:
 *   <Chevron open={isOpen} />: React state
 *   <details className="group"><Chevron /></...>: the browser, via group-open
 *
 * `group-open:rotate-90` is harmless outside a `group`/`<details>`, so both
 * mechanisms can live on the same component without a variant flag.
 */
export function Chevron({
  open,
  className = '',
}: {
  /** Omit inside a `<details className="group">`, the CSS handles it. */
  open?: boolean
  className?: string
}) {
  return (
    <svg
      aria-hidden="true"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      className={`shrink-0 text-i3x-text-muted transition-transform duration-150 motion-reduce:transition-none group-open:rotate-90 ${
        open ? 'rotate-90' : ''
      } ${className}`}
    >
      <path
        d="M3.5 1.5 L7 5 L3.5 8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
