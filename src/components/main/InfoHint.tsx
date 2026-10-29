import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CloseIcon } from '../common/icons'

/**
 * The "?" next to something that isn't self-explanatory.
 *
 * Explanations do not belong in body copy, a paragraph under a chart is read
 * once, by nobody, and it pushes the actual content down. This puts the caveat
 * behind a marker: hover for the one-liner, click for the full story.
 */
export function InfoHint({
  label,
  title,
  children,
  align = 'right',
}: {
  /** The hover tooltip, one line, says what the popup will explain. */
  label: string
  /** Heading of the popup. */
  title: string
  /** The explanation itself. */
  children: ReactNode
  /** Which edge of the button the panel hangs from. */
  align?: 'left' | 'right'
}) {
  const [isOpen, setIsOpen] = useState(false)
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!isOpen) return

    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  return (
    <span ref={wrapperRef} className="relative inline-flex align-middle">
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        onClick={() => setIsOpen(open => !open)}
        className={`w-4 h-4 grid place-items-center rounded-full border text-[9px] font-semibold leading-none transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary ${
          isOpen
            ? 'border-i3x-primary text-i3x-primary'
            : 'border-i3x-border text-i3x-text-muted hover:border-i3x-primary hover:text-i3x-primary'
        }`}
      >
        ?
      </button>

      {isOpen && (
        <span
          id={panelId}
          role="dialog"
          aria-label={title}
          className={`absolute top-6 z-30 w-[min(20rem,70vw)] bg-i3x-surface border border-i3x-border rounded-xl shadow-lg p-3 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <span className="flex items-start justify-between gap-2 mb-1.5">
            <b className="text-[12px] font-semibold text-i3x-text normal-case tracking-normal">
              {title}
            </b>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setIsOpen(false)}
              className="text-i3x-text-muted hover:text-i3x-text leading-none rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
            >
              <CloseIcon size={12} />
            </button>
          </span>
          <span className="block text-[11.5px] leading-relaxed text-i3x-text-muted normal-case tracking-normal font-normal">
            {children}
          </span>
        </span>
      )}
    </span>
  )
}
