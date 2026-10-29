import clsx from 'clsx'
import type { ReactNode } from 'react'
import { MarkdownContent } from './MarkdownContent'

export interface FormattedTextProps {
  children: string
  mimeType?: unknown
  className?: string
}

type TextRenderer = (content: string, className?: string) => ReactNode

const renderers: Record<string, TextRenderer> = {
  'text/markdown': (content, className) => (
    <MarkdownContent className={className}>{content}</MarkdownContent>
  ),
}

export function FormattedText({ children, mimeType, className }: FormattedTextProps) {
  const renderer = renderers[normalizeMimeType(mimeType)]
  if (renderer) return renderer(children, className)

  return (
    <p className={clsx('text-[13.5px] leading-relaxed text-i3x-text', className)}>
      {children}
    </p>
  )
}

function normalizeMimeType(mimeType: unknown) {
  if (typeof mimeType !== 'string') return ''
  return mimeType.split(';', 1)[0].trim().toLowerCase()
}