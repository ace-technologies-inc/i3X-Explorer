import { useEffect, useId, useRef, useState } from 'react'

/**
 * A one-field modal: ask for a number, hand it back. Exists because
 * `window.prompt` is disabled in Electron's renderer, so any "type a number"
 * flow needs a real dialog. Deliberately tiny: Enter confirms, Esc cancels,
 * the input takes focus and selects itself so typing replaces the default.
 */
export function NumberPromptDialog({
  title,
  description,
  label,
  initial,
  min = 1,
  max,
  confirmLabel = 'Show',
  onConfirm,
  onCancel,
}: {
  title: string
  /** One line under the title, for the count the user is acting on. */
  description?: string
  label: string
  initial: number
  min?: number
  max?: number
  confirmLabel?: string
  onConfirm: (value: number) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(String(initial))
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const titleId = useId()

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const parsed = Number.parseInt(text, 10)
  const valid =
    Number.isFinite(parsed) && parsed >= min && (max === undefined || parsed <= max)

  const submit = () => {
    if (valid) onConfirm(parsed)
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onPointerDown={event => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={event => {
          event.stopPropagation()
          if (event.key === 'Escape') onCancel()
          if (event.key === 'Enter') submit()
        }}
        className="w-[min(22rem,90vw)] bg-i3x-surface border border-i3x-border rounded-xl shadow-xl p-4"
      >
        <h2 id={titleId} className="text-sm font-semibold text-i3x-text">
          {title}
        </h2>
        {description && <p className="mt-1 text-[11.5px] text-i3x-text-muted">{description}</p>}

        <label htmlFor={inputId} className="block mt-3 text-[11.5px] text-i3x-text-muted">
          {label}
        </label>
        <input
          id={inputId}
          ref={inputRef}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={text}
          onChange={event => setText(event.target.value)}
          className="mt-1 w-full px-2 py-1.5 text-sm rounded-md bg-i3x-bg border border-i3x-border text-i3x-text tabular-nums focus:outline-none focus:border-i3x-primary"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded-md text-i3x-text-muted hover:text-i3x-text hover:bg-i3x-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!valid}
            className="px-3 py-1.5 text-xs rounded-md bg-i3x-primary text-white disabled:opacity-40 hover:bg-i3x-primary/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
