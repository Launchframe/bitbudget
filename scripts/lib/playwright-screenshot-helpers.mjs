/**
 * Playwright helpers for QA walkthrough screenshots (not imported by the app).
 */

/** Default matches Tailwind `duration-200` enter animation on DialogContent plus margin. */
const DEFAULT_DIALOG_SETTLE_MS = Number(process.env.DIALOG_SETTLE_MS || 1000)

/**
 * DOM readiness check (exported for unit tests).
 * @param {HTMLElement} el
 */
export function dialogContentLooksSettled(el) {
  const style = getComputedStyle(el)
  const opacity = Number.parseFloat(style.opacity)
  if (!Number.isFinite(opacity) || opacity < 0.99) return false
  const anims = typeof el.getAnimations === "function" ? el.getAnimations() : []
  return anims.length === 0 || anims.every((a) => a.playState !== "running")
}

/**
 * Wait until an open dialog finished its enter animation so screenshots are fully opaque.
 * Radix + animate-in fades opacity during the first ~200ms; capturing earlier looks transparent.
 */
export async function waitForDialogSettled(page, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DIALOG_SETTLE_MS
  const content = page.locator('[data-slot="dialog-content"][data-state="open"]')
  await content.waitFor({ state: "visible", timeout: options.waitTimeoutMs ?? 15_000 })
  const deadline = Date.now() + timeoutMs
  let ready = false
  while (Date.now() < deadline) {
    ready = await content.evaluate(dialogContentLooksSettled).catch(() => false)
    if (ready) break
    await page.waitForTimeout(50)
  }
  if (!ready) {
    throw new Error(
      "Dialog did not finish its enter animation before DIALOG_SETTLE_MS; refusing to screenshot a fading modal.",
    )
  }
  await page.waitForTimeout(100)
}
