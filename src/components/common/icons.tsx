import type { ReactNode } from 'react'

/**
 * The app's icon set. Every pictograph in the UI comes from here, stroke-based
 * SVGs on `currentColor`, so icons inherit text color, scale crisply at any
 * size, and render identically on every platform (the emoji they replaced
 * varied wildly between macOS/Windows/Linux and were unreadable in dark mode).
 *
 * All icons share one 24×24 grid and one stroke weight, so mixed sizes still
 * read as a family. Color belongs to the call site (`className="text-i3x-…"`),
 * not the icon.
 */

export interface IconProps {
  /** Rendered size in px (square). */
  size?: number
  className?: string
  strokeWidth?: number
}

function Icon({
  size = 16,
  className = '',
  strokeWidth = 1.8,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  )
}

/* ── Tree entity icons ────────────────────────────────────────────────────── */

/** Namespaces root folder: stacked layers. */
export const LayersIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3 3 8l9 5 9-5-9-5z" />
    <path d="m3 13 9 5 9-5" />
  </Icon>
)

/** Objects root folder: a flat grid of instances. */
export const GridIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" />
  </Icon>
)

/** Hierarchy root folder: one parent fanned out to two children. */
export const HierarchyIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="5" r="2.4" />
    <circle cx="5.5" cy="19" r="2.4" />
    <circle cx="18.5" cy="19" r="2.4" />
    <path d="M12 7.4v4.1M12 11.5H5.5v5.1M12 11.5h6.5v5.1" />
  </Icon>
)

/** Namespace: globe. */
export const GlobeIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a13.5 13.5 0 0 1 3.5 9A13.5 13.5 0 0 1 12 21a13.5 13.5 0 0 1-3.5-9A13.5 13.5 0 0 1 12 3z" />
  </Icon>
)

/** Object type: schema document. */
export const FileTextIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6M9 17h6" />
  </Icon>
)

/** FolderType instances and type definitions. */
export const FolderIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2h8.8A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
  </Icon>
)

/** Object instance: package/cube. */
export const CubeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 8.2a1.8 1.8 0 0 0-.9-1.56l-7.2-4.1a1.8 1.8 0 0 0-1.8 0l-7.2 4.1A1.8 1.8 0 0 0 3 8.2v7.6a1.8 1.8 0 0 0 .9 1.56l7.2 4.1a1.8 1.8 0 0 0 1.8 0l7.2-4.1a1.8 1.8 0 0 0 .9-1.56z" />
    <path d="M3.3 7.3 12 12.2l8.7-4.9" />
    <path d="M12 22v-9.8" />
  </Icon>
)

/** Variable/value instance: live signal trace. */
export const ActivityIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M22 12h-3.5L15 21 9 3l-3.5 9H2" />
  </Icon>
)

/** Non-hierarchical relationship type group: two interlocking chain links. */
export const LinkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.5 14.5 14.5 9.5" />
    <path d="M11 6.5 13 4.5a3.6 3.6 0 0 1 5 5l-2 2" />
    <path d="M13 17.5 11 19.5a3.6 3.6 0 0 1-5-5l2-2" />
  </Icon>
)

/* ── General UI icons ─────────────────────────────────────────────────────── */

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.8-4.8" />
  </Icon>
)

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
)

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m20 6.5-11 11L4 12.5" />
  </Icon>
)

export const PlayIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 4.5v15l12-7.5z" />
  </Icon>
)

export const PauseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8.5 5v14M15.5 5v14" />
  </Icon>
)

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5l1-12.5M9 7V4.5h6V7" />
  </Icon>
)

export const LockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4.5" y="11" width="15" height="9.5" rx="2" />
    <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
  </Icon>
)

export const WarningIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4.5M12 17.2v.05" />
  </Icon>
)

/** Update-available dialog: a little celebration without a platform emoji. */
export const SparklesIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    <path d="m19 14.5.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
  </Icon>
)

/** Server redirected: corner-up-right arrow. */
export const RedirectIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m15 14 5-5-5-5" />
    <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
  </Icon>
)

/** Unsupported/blocked: slashed circle. */
export const BlockedIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M5.6 5.6l12.8 12.8" />
  </Icon>
)

export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
  </Icon>
)

/** Focus/re-root control: concentric target. */
export const TargetIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="3.5" />
  </Icon>
)

/** Subscribe: radio broadcast. */
export const BroadcastIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <path d="M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4" />
    <path d="M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2" />
  </Icon>
)

/** Fill the window: arrows out of two opposite corners. */
export const MaximizeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15 3h6v6" />
    <path d="M9 21H3v-6" />
    <path d="M21 3l-7.5 7.5" />
    <path d="M3 21l7.5-7.5" />
  </Icon>
)

/** Back into the panel: the same arrows, pointing in. */
export const MinimizeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 10h6V4" />
    <path d="M10 14H4v6" />
    <path d="M20 4l-6 6" />
    <path d="M4 20l6-6" />
  </Icon>
)

/** Fit/reset view: four frame corners. */
export const FrameIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
    <path d="M16 3h3a2 2 0 0 1 2 2v3" />
    <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
  </Icon>
)

export const RefreshIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 12a9 9 0 1 1-2.6-6.4L21 8" />
    <path d="M21 3v5h-5" />
  </Icon>
)

/** Drag handle: 2×3 dot grip. */
export const GripIcon = (p: IconProps) => (
  <Icon {...p}>
    <g fill="currentColor" stroke="none">
      <circle cx="9" cy="5.5" r="1.4" />
      <circle cx="15" cy="5.5" r="1.4" />
      <circle cx="9" cy="12" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18.5" r="1.4" />
      <circle cx="15" cy="18.5" r="1.4" />
    </g>
  </Icon>
)

/** Collapse tree branches: chevrons folding toward the center. */
export const CollapseAllIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m7 4.5 5 5 5-5" />
    <path d="m7 19.5 5-5 5 5" />
  </Icon>
)

/** Expand all branches: chevrons unfolding away from the center. */
export const ExpandAllIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m7 9.5 5-5 5 5" />
    <path d="m7 14.5 5 5 5-5" />
  </Icon>
)

/** History: clock face. */
export const ClockIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </Icon>
)

/** Copy to clipboard: two offset sheets. */
export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
  </Icon>
)

/** Model insights: lightbulb. */
export const InsightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3a6 6 0 0 0-4 10.5c.9.8 1.4 1.6 1.6 2.5h4.8c.2-.9.7-1.7 1.6-2.5A6 6 0 0 0 12 3z" />
    <path d="M9.5 19h5" />
    <path d="M10.5 21.5h3" />
  </Icon>
)

/** A population split: one path forking into two. */
export const SplitIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 12h4c3.5 0 3.5-4.5 7-4.5h7" />
    <path d="M7 12c3.5 0 3.5 4.5 7 4.5h7" />
  </Icon>
)

/** Snapshot: camera. */
export const CameraIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 18.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-10A1.5 1.5 0 0 1 4.5 7H8l1.7-2.4A1.5 1.5 0 0 1 10.9 4h2.2a1.5 1.5 0 0 1 1.2.6L16 7h3.5A1.5 1.5 0 0 1 21 8.5z" />
    <circle cx="12" cy="13" r="3.6" />
  </Icon>
)

/** Truncated child list: horizontal ellipsis. */
export const EllipsisIcon = (p: IconProps) => (
  <Icon {...p}>
    <g fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </g>
  </Icon>
)

/** Save to disk: tray with a down arrow. */
export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M4 20h16" />
  </Icon>
)

/** Settings: gear. */
export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v2M12 19.5v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2.5 12h2M19.5 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
  </Icon>
)

/** Code / view request: angle brackets. */
export const CodeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m8 6-6 6 6 6" />
    <path d="m16 6 6 6-6 6" />
  </Icon>
)
