import type { KeyboardEvent } from "react"

/**
 * In a dialog, Enter submits the primary action (single-line fields only).
 * Skip for Shift+Enter, textarea, or nodes marked `data-no-enter-submit`.
 */
export function handleDialogEnterToPrimary(
  e: KeyboardEvent<HTMLDivElement>,
  opts: { disabled?: boolean; onPrimary: () => void },
): void {
  if (e.key !== "Enter" || e.shiftKey) return
  const el = e.target
  if (!(el instanceof HTMLElement)) return
  if (el.closest("[data-no-enter-submit]")) return
  if (el.isContentEditable) return
  const tag = el.tagName
  if (tag === "TEXTAREA") return
  if (opts.disabled) return
  e.preventDefault()
  opts.onPrimary()
}
