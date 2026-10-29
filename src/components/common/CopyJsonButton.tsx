import { useState } from 'react'
import { CheckIcon, CopyIcon } from './icons'

/**
 * Like details/CopyButton, but the payload is built on click, never eagerly.
 * For panes whose copy payload is expensive (a 50k-row diff category, a
 * finding's full outlier list), building the JSON on render would tax every
 * frame for a button almost nobody presses.
 */
export function CopyJsonButton({ build, title }: { build: () => string; title: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(build())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable (insecure context), fail quietly, as CopyButton does.
    }
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied!' : title}
      aria-label={title}
      className="p-1 rounded text-i3x-text-muted hover:text-i3x-text hover:bg-i3x-bg transition-colors motion-reduce:transition-none"
    >
      {copied ? <CheckIcon size={14} className="text-i3x-success" /> : <CopyIcon size={14} />}
    </button>
  )
}
