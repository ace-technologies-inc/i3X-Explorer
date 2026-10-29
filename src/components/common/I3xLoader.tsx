import { useId } from 'react'
import iconUrl from '/icon-512.png'

/**
 * The app icon itself (public/icon-512.png, the same emblem the toolbar
 * brand uses, at full resolution), animated as the app's large loading state:
 * the vortex slowly spins, a green glow breathes behind it, and two gradient
 * comet arcs orbit it in opposite directions. Using the real asset keeps the
 * mark pixel-faithful; the arcs pick up the logo's palette from the theme's
 * green→blue accent tokens, and the gradient id comes from `useId` so several
 * loaders can be on screen at once.
 *
 * Keyframes live in `styles/index.css` (`.i3x-loader-*`). Reduced motion
 * hides the arcs and freezes the rest, pair the loader with a text label
 * that carries the state.
 *
 * Use for surface-level loads (tree, overview, graphs); inline and button
 * loads use the plain `Spinner`.
 */
export function I3xLoader({ size = 56, className = '' }: { size?: number; className?: string }) {
  const gradId = `${useId()}-grad`
  const stroke = `url(#${gradId})`

  return (
    <div
      aria-hidden="true"
      className={`relative shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      {/* Breathing glow behind the emblem */}
      <div className="i3x-loader-glow absolute inset-0 rounded-full" />

      {/* The emblem, slowly churning. Inset leaves room for the orbit arcs. */}
      <img
        src={iconUrl}
        alt=""
        draggable={false}
        className="i3x-loader-img pointer-events-none absolute inset-[7%] h-[86%] w-[86%] select-none"
      />

      {/* Two comet arcs orbiting in opposite directions */}
      <svg viewBox="0 0 100 100" fill="none" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1="40" y1="0" x2="62" y2="100">
            <stop offset="0%" stopColor="rgb(var(--i3x-success))" />
            <stop offset="45%" stopColor="rgb(var(--i3x-success))" />
            <stop offset="100%" stopColor="rgb(var(--i3x-primary))" />
          </linearGradient>
        </defs>
        <circle
          className="i3x-loader-ring"
          cx="50"
          cy="50"
          r="48.4"
          stroke={stroke}
          strokeWidth="2.4"
          strokeLinecap="round"
          pathLength={100}
        />
        <circle
          className="i3x-loader-ring i3x-loader-ring-2"
          cx="50"
          cy="50"
          r="48.4"
          stroke={stroke}
          strokeWidth="2.4"
          strokeLinecap="round"
          pathLength={100}
          style={{ animationDelay: '-0.6s' }}
        />
      </svg>
    </div>
  )
}
