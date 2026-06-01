/**
 * Normalize free-form USD draft strings for onboarding income fields.
 * Strips leading zeros, limits decimals, and keeps a trailing "." while typing.
 */
export function normalizeUsdDraftInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "")
  if (cleaned === "") return ""

  const firstDot = cleaned.indexOf(".")
  let intPart: string
  let decPart: string | undefined
  let trailingDot = false

  if (firstDot === -1) {
    intPart = cleaned
  } else {
    intPart = cleaned.slice(0, firstDot)
    const afterDot = cleaned.slice(firstDot + 1).replace(/\./g, "")
    trailingDot = cleaned.endsWith(".") && afterDot === ""
    decPart = afterDot.slice(0, 2)
  }

  if (intPart === "") {
    intPart = "0"
  } else {
    intPart = intPart.replace(/^0+(?=\d)/, "") || "0"
  }

  if (decPart === undefined && !trailingDot) return intPart
  if (trailingDot && decPart === "") return `${intPart}.`
  return `${intPart}.${decPart}`
}

/** Parse a normalized draft to a positive USD amount, or null if empty/invalid/incomplete. */
export function parseUsdDraftInput(raw: string): number | null {
  const normalized = normalizeUsdDraftInput(raw)
  if (normalized === "" || normalized.endsWith(".")) return null
  const value = Number.parseFloat(normalized)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value * 100) / 100
}
