import { useState, useCallback } from 'react'
import { faCheck, faCopy } from '@fortawesome/free-solid-svg-icons'
import { Icon } from './Icon'

/** How long the button says "Copied!" before it returns to its label. */
export const COPIED_FEEDBACK_MS = 2000

export interface CopyButtonProps {
  /** The exact text copied to the clipboard. */
  text: string
  /** The label shown before the text is copied. */
  label: string
  /** `primary` is the filled accent button; `secondary` is the outlined one. */
  variant?: 'primary' | 'secondary'
}

/**
 * A button that copies `text` to the clipboard and says "Copied!" for a moment.
 *
 * If the clipboard is refused (no permission, or the browser has no clipboard), the button
 * keeps its label and says nothing, because there is no copy to confirm.
 *
 * @param props.text The exact text to copy.
 * @param props.label The label before the copy.
 * @param props.variant The button's look.
 */
export default function CopyButton({ text, label, variant = 'primary' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
    } catch {
      // Clipboard API not available — silently ignore
    }
  }, [text])

  const baseClass =
    variant === 'primary'
      ? 'rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-accent-soft disabled:opacity-50'
      : 'rounded-lg border border-border bg-surface-inset px-4 py-2 text-sm font-medium text-content-muted transition-colors hover:bg-surface-control hover:text-content-body'

  return (
    <button type="button" onClick={handleCopy} className={baseClass}>
      {copied ? (
        <>
          <Icon icon={faCheck} className="mr-2 text-xs" />
          Copied!
        </>
      ) : (
        <>
          <Icon icon={faCopy} className="mr-2 text-xs" />
          {label}
        </>
      )}
    </button>
  )
}
