import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CheckIcon, DownloadIcon, SettingsIcon } from '../common/icons'
import { useExplorerStore, type GraphLeafMode } from '../../stores/explorer'
import { downloadSvgAsPng, mapFilename } from './exportPng'
import type { LegendEntry } from './graphSettings'

/**
 * The gear in a relationship map's control cluster: a small popover of per-map
 * display settings, plus a one-shot "Download PNG". Unlike the app's shared
 * ContextMenu (which closes on every pick), this stays open while toggles are
 * flipped, since trying several together is the point. Both the Tree and Rings
 * views mount one; the settings live in the store, so they apply to both.
 */
export function GraphSettingsMenu({
  getSvg,
  rootName,
  viewSuffix,
  legend,
}: {
  /** Reads the live svg at click time (it may not exist while a walk loads). */
  getSvg: () => SVGSVGElement | null
  /** The rooted element's name, for the download's file name. */
  rootName: string
  /** `tree` or `rings`, appended to the file name so both views are distinct. */
  viewSuffix: string
  /** When color-by-type is on, the key to stamp into the downloaded PNG. */
  legend?: LegendEntry[]
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  // Rendered hidden for one frame, measured, then clamped into the viewport.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const leafMode = useExplorerStore(s => s.graphLeafMode)
  const setLeafMode = useExplorerStore(s => s.setGraphLeafMode)
  const fadeDistant = useExplorerStore(s => s.graphFadeDistant)
  const setFadeDistant = useExplorerStore(s => s.setGraphFadeDistant)
  const sortBySize = useExplorerStore(s => s.graphSortBySize)
  const setSortBySize = useExplorerStore(s => s.setGraphSortBySize)
  const colorByType = useExplorerStore(s => s.graphColorByType)
  const setColorByType = useExplorerStore(s => s.setGraphColorByType)

  const close = useCallback(() => {
    setOpen(false)
    setPos(null)
    buttonRef.current?.focus({ preventScroll: true })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    const btn = buttonRef.current
    const panel = panelRef.current
    if (!btn || !panel) return
    const b = btn.getBoundingClientRect()
    const p = panel.getBoundingClientRect()
    setPos({
      x: Math.max(8, Math.min(b.right - p.width, window.innerWidth - p.width - 8)),
      y: Math.max(8, Math.min(b.bottom + 4, window.innerHeight - p.height - 8)),
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', close)
    }
  }, [open, close])

  const download = () => {
    const svg = getSvg()
    if (svg) void downloadSvgAsPng(svg, mapFilename(rootName, viewSuffix), { legend })
    close()
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Map settings"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Map settings"
        onClick={() => (open ? close() : setOpen(true))}
        className="w-8 h-8 grid place-items-center border border-i3x-border bg-i3x-surface rounded-lg text-i3x-text-muted hover:bg-i3x-bg hover:text-i3x-text transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
      >
        <SettingsIcon size={13} />
      </button>

      {open && (
        <div
          ref={panelRef}
          role="menu"
          aria-label="Map settings"
          style={{
            position: 'fixed',
            left: pos?.x ?? 0,
            top: pos?.y ?? 0,
            visibility: pos ? 'visible' : 'hidden',
          }}
          className="z-50 w-[220px] bg-i3x-surface border border-i3x-border rounded-lg shadow-xl py-1.5 text-sm"
        >
          <SectionLabel>Leaves</SectionLabel>
          {LEAF_OPTIONS.map(option => (
            <Row
              key={option.value}
              checked={leafMode === option.value}
              onClick={() => setLeafMode(option.value)}
            >
              {option.label}
            </Row>
          ))}

          <Divider />
          <SectionLabel>Display</SectionLabel>
          <Row checked={fadeDistant} onClick={() => setFadeDistant(!fadeDistant)}>
            Fade distant nodes
          </Row>
          <Row checked={sortBySize} onClick={() => setSortBySize(!sortBySize)}>
            Sort by branch size
          </Row>
          <Row checked={colorByType} onClick={() => setColorByType(!colorByType)}>
            Color by type
          </Row>

          <Divider />
          <button
            type="button"
            role="menuitem"
            onClick={download}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-i3x-text hover:bg-i3x-bg focus:outline-none focus-visible:bg-i3x-bg"
          >
            <span className="w-4 flex items-center justify-center text-i3x-text-muted flex-shrink-0">
              <DownloadIcon size={14} />
            </span>
            <span className="flex-1 truncate">Download PNG</span>
          </button>
        </div>
      )}
    </>
  )
}

const LEAF_OPTIONS: { value: GraphLeafMode; label: string }[] = [
  { value: 'show', label: 'Show all' },
  { value: 'hide', label: 'Hide leaf nodes' },
  { value: 'collapse', label: 'Collapse leaves (+N)' },
]

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-1 pb-1 text-[11px] font-semibold text-i3x-text-muted">{children}</div>
  )
}

function Divider() {
  return <div role="separator" className="my-1 border-t border-i3x-border" />
}

/** A menu row that shows a check when active; used for both radios and toggles. */
function Row({
  checked,
  onClick,
  children,
}: {
  checked: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-i3x-text hover:bg-i3x-bg focus:outline-none focus-visible:bg-i3x-bg"
    >
      <span className="w-4 flex items-center justify-center text-i3x-primary flex-shrink-0">
        {checked && <CheckIcon size={14} />}
      </span>
      <span className="flex-1 truncate">{children}</span>
    </button>
  )
}
