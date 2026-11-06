import { useEffect, useState } from 'react'

const SHOW_DELAY_MS = 400
const EDGE_MARGIN = 8

interface Tip {
  text: string
  x: number
  y: number
}

/**
 * One app-wide tooltip for every element with a `title`. Electron's native
 * tooltips are unreliable (they are suppressed for SVG children, and the toolbar
 * buttons are mostly icons), so the title is lifted into an HTML overlay while
 * the pointer is over the element and put back when it leaves.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null)

  useEffect(() => {
    let timer: number | undefined
    let active: HTMLElement | null = null

    const restore = () => {
      window.clearTimeout(timer)
      if (active) {
        const text = active.getAttribute('data-tip')
        if (text !== null && !active.hasAttribute('title')) active.setAttribute('title', text)
        active.removeAttribute('data-tip')
        active = null
      }
      setTip(null)
    }

    const onOver = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null
      const el = target?.closest<HTMLElement>('[title], [data-tip]') ?? null
      if (el === active) return
      restore()
      if (!el) return
      const text = el.getAttribute('title') || el.getAttribute('data-tip')
      if (!text) return
      el.setAttribute('data-tip', text)
      el.removeAttribute('title')
      active = el
      timer = window.setTimeout(() => {
        const r = el.getBoundingClientRect()
        setTip({ text, x: r.left + r.width / 2, y: r.bottom + 6 })
      }, SHOW_DELAY_MS)
    }

    document.addEventListener('mouseover', onOver)
    document.addEventListener('mousedown', restore)
    document.addEventListener('scroll', restore, true)
    window.addEventListener('blur', restore)
    return () => {
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mousedown', restore)
      document.removeEventListener('scroll', restore, true)
      window.removeEventListener('blur', restore)
      restore()
    }
  }, [])

  if (!tip) return null
  return (
    <div
      role="tooltip"
      className="fixed z-[100] max-w-xs px-2 py-1 rounded border border-i3x-border bg-i3x-surface text-i3x-text text-xs shadow-lg pointer-events-none"
      style={{
        left: Math.min(Math.max(tip.x, EDGE_MARGIN + 140), window.innerWidth - EDGE_MARGIN - 140),
        top: tip.y,
        transform: 'translateX(-50%)'
      }}
    >
      {tip.text}
    </div>
  )
}
