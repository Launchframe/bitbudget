/**
 * Itemized receipt extraction types and fail-closed validation.
 * Model output is untrusted. Truncated or inconsistent receipts stay in review.
 */

import { SHOPPING_MAX_RECEIPT_LINES, type ShoppingReceiptLine } from "@/lib/shopping-types"
import { dollarsToCents, ShoppingSplitError } from "@/lib/shopping-split-math"

export const ITEMIZED_RECEIPT_MAX_TOKENS = 2500
export const ITEMIZED_PDF_TEXT_CHARS = 16_000

export const ITEMIZED_RECEIPT_EXTRACTION_PROMPT = `You are a grocery receipt parser. Extract merchant, date, currency, totals, and line items.

Respond ONLY with valid JSON:
{"merchant":"...","date":"YYYY-MM-DD","currency":"USD","subtotal":"12.34","tax":"1.00","discount":"0.00","fees":"0.00","total":"13.34","truncated":false,"lines":[{"description":"...","quantity":1,"unit":"each","amount":"1.00","unitPrice":"1.00","confidence":0.9}]}

Rules:
- currency must be USD. If the receipt is not USD, set currency to the printed code and leave totals as empty strings.
- truncated is true if the receipt has more lines than you listed.
- amount is the line total. quantity is a number. Use unit "each" when unknown.
- If a field is unreadable, use an empty string (or 0 for quantity). Do not invent a total.`

export interface ItemizedReceiptExtraction {
  merchant: string
  date: string
  currency: string
  subtotalCents: number | null
  taxCents: number | null
  discountCents: number | null
  feeCents: number | null
  totalCents: number | null
  truncated: boolean
  lines: ShoppingReceiptLine[]
  extractionConfidence: number
}

export type ItemizedReceiptIssue =
  | "unsupported_currency"
  | "truncated"
  | "malformed"
  | "inconsistent_total"
  | "missing_total"
  | "too_many_lines"

export interface ItemizedReceiptValidation {
  extraction: ItemizedReceiptExtraction | null
  issues: ItemizedReceiptIssue[]
}

function optionalCents(value: unknown): number | null {
  if (value === "" || value == null) return null
  try {
    return dollarsToCents(value)
  } catch {
    return null
  }
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function parseItemizedModelOutput(raw: unknown): ItemizedReceiptValidation {
  const issues: ItemizedReceiptIssue[] = []
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { extraction: null, issues: ["malformed"] }
  }
  const obj = raw as Record<string, unknown>
  const merchant = typeof obj.merchant === "string" ? obj.merchant.replace(/\s+/g, " ").trim().slice(0, 200) : ""
  const date = typeof obj.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.date.trim()) ? obj.date.trim() : ""
  const currency = typeof obj.currency === "string" ? obj.currency.trim().toUpperCase() : ""
  if (currency && currency !== "USD") issues.push("unsupported_currency")
  if (obj.truncated === true) issues.push("truncated")

  if (!Array.isArray(obj.lines)) {
    return { extraction: null, issues: [...issues, "malformed"] }
  }
  if (obj.lines.length > SHOPPING_MAX_RECEIPT_LINES) {
    issues.push("too_many_lines")
  }

  const lines: ShoppingReceiptLine[] = []
  for (let i = 0; i < Math.min(obj.lines.length, SHOPPING_MAX_RECEIPT_LINES); i++) {
    const lineRaw = obj.lines[i]
    if (!lineRaw || typeof lineRaw !== "object") {
      issues.push("malformed")
      continue
    }
    const line = lineRaw as Record<string, unknown>
    let lineAmountCents: number
    try {
      lineAmountCents = dollarsToCents(line.amount ?? line.lineAmount ?? 0)
    } catch (err) {
      if (err instanceof ShoppingSplitError) {
        issues.push("malformed")
        continue
      }
      throw err
    }
    const qty = asFiniteNumber(line.quantity) ?? 1
    const confidence = asFiniteNumber(line.confidence)
    let unitPriceCents: number | undefined
    if (line.unitPrice != null && line.unitPrice !== "") {
      try {
        unitPriceCents = dollarsToCents(line.unitPrice)
      } catch {
        unitPriceCents = undefined
      }
    }
    lines.push({
      id: `line-${i + 1}`,
      description: typeof line.description === "string" ? line.description.replace(/\s+/g, " ").trim().slice(0, 200) : "",
      quantity: qty < 0 ? 0 : qty,
      unit: typeof line.unit === "string" && line.unit.trim() ? line.unit.trim().slice(0, 24) : "each",
      lineAmountCents,
      unitPriceCents,
      confidence: confidence == null ? undefined : Math.max(0, Math.min(1, confidence)),
    })
  }

  const subtotalCents = optionalCents(obj.subtotal)
  const taxCents = optionalCents(obj.tax)
  const discountCents = optionalCents(obj.discount)
  const feeCents = optionalCents(obj.fees ?? obj.fee)
  const totalCents = optionalCents(obj.total)
  if (totalCents == null) issues.push("missing_total")

  if (totalCents != null && subtotalCents != null) {
    const reconstructed =
      subtotalCents - (discountCents ?? 0) + (taxCents ?? 0) + (feeCents ?? 0)
    if (reconstructed !== totalCents) {
      issues.push("inconsistent_total")
    }
  }

  const confidences = lines.map((l) => l.confidence).filter((c): c is number => c != null)
  const extractionConfidence =
    confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : merchant && totalCents != null ? 0.5 : 0.2

  return {
    extraction: {
      merchant,
      date,
      currency: currency || "USD",
      subtotalCents,
      taxCents,
      discountCents,
      feeCents,
      totalCents,
      truncated: obj.truncated === true,
      lines,
      extractionConfidence,
    },
    issues: [...new Set(issues)],
  }
}

export function canFinalizeItemizedExtraction(issues: readonly ItemizedReceiptIssue[]): boolean {
  return issues.length === 0
}
