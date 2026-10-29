import { useState } from 'react'

interface CopyButtonProps {
  /** Text placed on the clipboard when clicked. */
  text: string
  /** Extra classes for positioning (e.g. absolute placement by the parent). */
  className?: string
  title?: string
}

/**
 * Small floating clipboard icon. Drops into any `relative` container, the
 * default positioning pins it to the top-right corner of the pane. Briefly
 * flips to a checkmark on success.
 */
export function CopyButton({ text, className = '', title = 'Copy to clipboard' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e: React.MouseEvent) => {
    // Containers like the collapsed JsonViewer use onClick to expand, don't trigger that.
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API unavailable (insecure context / denied permission), fail quietly.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied!' : title}
      aria-label={title}
      className={`p-1 rounded text-i3x-text-muted hover:text-i3x-text hover:bg-i3x-bg transition-colors ${className}`}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-i3x-success">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  )
}
