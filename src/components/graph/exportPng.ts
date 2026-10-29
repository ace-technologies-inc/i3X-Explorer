/**
 * Export a live relationship-map `<svg>` to a PNG the user can save.
 *
 * The map is drawn with Tailwind classes and CSS custom properties
 * (`fill-i3x-text`, `rgb(var(--i3x-primary))`, …). None of that survives being
 * serialized on its own: an `<svg>` rasterized through an `<img>` renders in
 * isolation with no document stylesheet, so every class and variable would drop
 * to its unstyled default. So we clone the node and walk it against the live
 * one, copying each element's *computed* presentation values inline, everything
 * is already resolved to concrete colors and sizes by the time we read them.
 *
 * The capture is WYSIWYG: the clone keeps the svg's current `viewBox` and the
 * pan/zoom transform on the inner `<g>`, so the PNG is exactly the framing on
 * screen. The transparent svg is composited over the pane's background color so
 * the file isn't see-through. When color-by-type is on, the type legend (an HTML
 * overlay, so not part of the svg) is redrawn onto the canvas so the key travels
 * with the image.
 */

import type { LegendEntry } from './graphSettings'

// The presentation properties that carry how a node/edge/label looks. Reading
// computed values resolves classes, `currentColor`, and CSS variables to
// concrete strings, so the clone needs no stylesheet.
const STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'paint-order',
] as const

function inlineComputedStyles(source: Element, clone: Element): void {
  const computed = getComputedStyle(source)
  const style = (clone as SVGElement).style
  for (const prop of STYLE_PROPS) {
    const value = computed.getPropertyValue(prop)
    if (value) style.setProperty(prop, value)
  }
  const sourceChildren = source.children
  const cloneChildren = clone.children
  for (let i = 0; i < sourceChildren.length; i++) {
    const cloneChild = cloneChildren[i]
    if (cloneChild) inlineComputedStyles(sourceChildren[i], cloneChild)
  }
}

export interface ExportPngOptions {
  /** Pixel multiplier for a crisper file. Defaults to 2. */
  scale?: number
  /** Type key to stamp into the bottom-left, matching the on-screen legend. */
  legend?: LegendEntry[]
}

/** Rasterize `svg` at its on-screen size and trigger a `<filename>.png` download. */
export async function downloadSvgAsPng(
  svg: SVGSVGElement,
  filename: string,
  options: ExportPngOptions = {}
): Promise<void> {
  const scale = options.scale ?? 2
  const rect = svg.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))

  const clone = svg.cloneNode(true) as SVGSVGElement
  inlineComputedStyles(svg, clone)
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  clone.removeAttribute('class')

  // The svg itself is transparent; its background is the pane div behind it.
  const background =
    (svg.parentElement && getComputedStyle(svg.parentElement).backgroundColor) || '#ffffff'

  const serialized = new XMLSerializer().serializeToString(clone)
  const svgUrl = URL.createObjectURL(
    new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' })
  )

  try {
    const image = await loadImage(svgUrl)
    const canvas = document.createElement('canvas')
    canvas.width = width * scale
    canvas.height = height * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.fillStyle = background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

    if (options.legend && options.legend.length > 0) {
      drawLegend(ctx, options.legend, scale, canvas.height, resolveLegendColors(svg))
    }

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Failed to encode PNG')
    triggerDownload(blob, filename.endsWith('.png') ? filename : `${filename}.png`)
  } finally {
    URL.revokeObjectURL(svgUrl)
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load SVG for export'))
    image.src = url
  })
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** A filesystem-safe base name for a map rooted on `label`. */
export function mapFilename(label: string, suffix: string): string {
  const safe = label.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'relationships'
  return `${safe}-${suffix}`
}

interface LegendColors {
  surface: string
  border: string
  text: string
  muted: string
}

/** Resolve the theme's legend colors from the live element's CSS variables. */
function resolveLegendColors(el: Element): LegendColors {
  const style = getComputedStyle(el)
  const rgb = (name: string, fallback: string) => {
    const channels = style.getPropertyValue(name).trim()
    return channels ? `rgb(${channels})` : fallback
  }
  return {
    surface: rgb('--i3x-surface', '#ffffff'),
    border: rgb('--i3x-border', '#d9d9d9'),
    text: rgb('--i3x-text', '#111111'),
    muted: rgb('--i3x-text-muted', '#666666'),
  }
}

// Cap the rows drawn so a many-type key can't grow taller than the image.
const LEGEND_MAX_ROWS = 16

/** Redraw the type key at the bottom-left, matching the on-screen legend. */
function drawLegend(
  ctx: CanvasRenderingContext2D,
  entries: LegendEntry[],
  scale: number,
  canvasHeight: number,
  colors: LegendColors
): void {
  const rows = entries.slice(0, LEGEND_MAX_ROWS)
  const extra = entries.length - rows.length
  const pad = 10 * scale
  const sw = 11 * scale
  const gap = 7 * scale
  const rowH = 18 * scale
  const font = 12 * scale
  const titleH = font + 8 * scale
  const labelCap = 150 * scale
  const titleFont = `600 ${font}px system-ui, -apple-system, sans-serif`
  const rowFont = `${font}px system-ui, -apple-system, sans-serif`

  ctx.textBaseline = 'middle'
  ctx.font = titleFont
  let contentW = ctx.measureText('Types').width
  ctx.font = rowFont
  for (const row of rows) {
    const labelW = Math.min(ctx.measureText(row.label).width, labelCap)
    const countW = ctx.measureText(String(row.count)).width
    contentW = Math.max(contentW, sw + gap + labelW + gap * 2 + countW)
  }
  if (extra > 0) contentW = Math.max(contentW, ctx.measureText(`+${extra} more`).width)

  const boxW = pad * 2 + contentW
  const boxH = pad * 2 + titleH + rows.length * rowH + (extra > 0 ? rowH : 0)
  const x = 12 * scale
  const y = canvasHeight - boxH - 12 * scale

  roundRect(ctx, x, y, boxW, boxH, 8 * scale)
  ctx.fillStyle = colors.surface
  ctx.fill()
  ctx.lineWidth = scale
  ctx.strokeStyle = colors.border
  ctx.stroke()

  ctx.font = titleFont
  ctx.fillStyle = colors.muted
  ctx.textAlign = 'left'
  ctx.fillText('Types', x + pad, y + pad + font / 2)

  ctx.font = rowFont
  let ry = y + pad + titleH + rowH / 2
  for (const row of rows) {
    roundRect(ctx, x + pad, ry - sw / 2, sw, sw, 2 * scale)
    ctx.fillStyle = row.color
    ctx.fill()

    ctx.fillStyle = colors.text
    ctx.textAlign = 'left'
    ctx.fillText(clipText(ctx, row.label, labelCap), x + pad + sw + gap, ry)

    ctx.fillStyle = colors.muted
    ctx.textAlign = 'right'
    ctx.fillText(String(row.count), x + boxW - pad, ry)
    ry += rowH
  }
  if (extra > 0) {
    ctx.fillStyle = colors.muted
    ctx.textAlign = 'left'
    ctx.fillText(`+${extra} more`, x + pad, ry)
  }
  ctx.textAlign = 'left'
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
}

/** Middle-of-the-road truncation: append an ellipsis until the text fits `maxWidth`. */
function clipText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let clipped = text
  while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
    clipped = clipped.slice(0, -1)
  }
  return `${clipped}…`
}
