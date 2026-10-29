/**
 * The app's one loading marker: a stroke-drawn arc on the same 24×24 grid as
 * the icon set (`icons.tsx`), spun by Tailwind's `animate-spin`. Color comes
 * from the call site via `currentColor`, like every other icon.
 *
 * Always pair it with a text label, under reduced motion the arc freezes, so
 * the words have to carry the state on their own.
 */
export function Spinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      className={`shrink-0 animate-spin motion-reduce:animate-none ${className}`}
    >
      <circle cx="12" cy="12" r="9" strokeOpacity={0.25} />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  )
}
