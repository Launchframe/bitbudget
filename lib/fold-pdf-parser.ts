/**
 * Parser for Fold debit card statement PDFs.
 *
 * The text extracted from a Fold PDF by pdf-parse looks like:
 *
 *   Fold, Inc
 *   ...header / account info...
 *   Statement Summary
 *   Opening balance $6,455.79
 *   ...
 *   Transactions
 *   Settlement Date Amount Balance Merchant
 *   2026-01-02 04:59 ($293.25) $6,162.54 SP BJS RAW PET FOOD
 *   2026-01-02 06:19 ($673.63) $5,488.91 FORTH
 *   ...
 *   Page 1/4
 *   -- 1 of 4 --
 *   <next transactions>
 *   ...
 *   Processed by:
 *   SUTTON BANK
 *   ...legal text...
 *
 * Transaction amounts:
 *   - Debit  → "(${value})"    e.g. ($293.25)
 *   - Credit → "${value}"      e.g. $5,910.11
 *
 * Multi-line merchants: a merchant name may wrap to the next line (no date prefix).
 * Special case: Fold subscription fee shows $0.00 in the amount column, with the real
 *   fee on a standalone "($10.00) Fold+ Subscription" line that follows the merchant name.
 */

import type { ParsedTransaction } from "@/lib/csv"

// Matches "2026-01-02 04:59 ($293.25) $6,162.54 SP BJS RAW PET FOOD"
// Groups: [1]=date [2]=time [3]=txn_amount [4]=balance [5]=merchant (may be empty)
const TXN_LINE_RE =
  /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(\(\$[\d,]+\.\d{2}\)|\$[\d,]+\.\d{2})\s+(\(\$[\d,]+\.\d{2}\)|\$[\d,]+\.\d{2})\s*(.*)/

// Matches a standalone amount like "($10.00) Fold+ Subscription" (fee detail line)
const FEE_DETAIL_RE = /^(\(\$[\d,]+\.\d{2}\)|\$[\d,]+\.\d{2})\s+(.*)/

// Lines to discard unconditionally
const PAGE_MARKER_RE = /^(Page \d+\/\d+|--\s+\d+ of \d+\s+--)$/i
const COLUMN_HEADER_RE = /^Settlement Date\s+Amount\s+Balance\s+Merchant/i
const LEGAL_STOP_RE = /^Processed by:/i

export interface FoldStatementMeta {
  accountNumber?: string
  periodStart?: string
  periodEnd?: string
  /** Always "Fold" for this parser. Carried through to StatementImporterDialog for title display. */
  institutionName?: string
}

export interface FoldStatementParseResult {
  transactions: ParsedTransaction[]
  meta: FoldStatementMeta
}

/** Parse amount strings like "($293.25)" → -293.25, "$5,910.11" → 5910.11 */
export function parsePdfAmount(s: string): number | null {
  const negative = s.startsWith("(") && s.endsWith(")")
  const clean = s.replace(/[()$,]/g, "")
  const val = parseFloat(clean)
  if (isNaN(val)) return null
  return negative ? -val : val
}

/** Convert "MM/DD/YYYY" to "YYYY-MM-DD". Returns null if not parseable. */
function parseMDY(s: string): string | null {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[1]}-${m[2]}`
}

/**
 * Return true when the extracted PDF text looks like a Fold bank statement.
 *
 * Used by the unified /api/receipts/scan endpoint to decide whether to run the
 * regex-based statement parser (free, no OpenAI) or the receipt extraction path
 * (requires premium + OPENAI_API_KEY).
 *
 * The column header line "Settlement Date Amount Balance Merchant" is distinctive
 * enough that it will not appear in any normal receipt PDF.
 */
export function isFoldStatementText(text: string): boolean {
  return (
    /\bTransactions\b/.test(text) &&
    /Settlement Date\s+Amount\s+Balance\s+Merchant/i.test(text)
  )
}

/**
 * Parse the text extracted from a Fold PDF statement into transactions and metadata.
 *
 * @param text  Plain text output from pdf-parse
 */
export function parseFoldPdfText(text: string): FoldStatementParseResult {
  const lines = text.split("\n")
  const meta: FoldStatementMeta = { institutionName: "Fold" }

  // --- Extract metadata (scans the whole document) ---
  for (const line of lines) {
    const t = line.trim()
    const accMatch = t.match(/Account Number:\s*(\S+)/)
    if (accMatch) meta.accountNumber = accMatch[1]

    const periodMatch = t.match(/Period Covered\s+(\d{2}\/\d{2}\/\d{4})-(\d{2}\/\d{2}\/\d{4})/)
    if (periodMatch) {
      meta.periodStart = parseMDY(periodMatch[1]) ?? undefined
      meta.periodEnd = parseMDY(periodMatch[2]) ?? undefined
    }
  }

  // --- Parse transactions ---
  const transactions: ParsedTransaction[] = []

  let inTransactions = false
  let pastColumnHeader = false

  // `current` accumulates the in-progress transaction row (may span multiple lines).
  let current: {
    date: string
    payee: string
    amount: number
    type: "expense" | "credit"
    /** true once the amount has been finalised (handles the $0 fee-detail pattern) */
    amountFinalised: boolean
  } | null = null

  function pushCurrent() {
    if (!current) return
    if (current.amount > 0) {
      transactions.push({
        date: current.date,
        payee: current.payee.trim(),
        amount: current.amount,
        type: current.type,
        envelopeName: "Uncategorized",
        notes: null,
      })
    }
    current = null
  }

  for (const line of lines) {
    const trimmed = line.trim()

    // Find the start of the Transactions section
    if (!inTransactions) {
      if (trimmed === "Transactions") inTransactions = true
      continue
    }

    // Stop at the legal/footer section
    if (LEGAL_STOP_RE.test(trimmed)) {
      pushCurrent()
      break
    }

    // Skip blank lines and page markers
    if (!trimmed || PAGE_MARKER_RE.test(trimmed)) continue

    // Skip the column header row once (appears right after "Transactions")
    if (!pastColumnHeader && COLUMN_HEADER_RE.test(trimmed)) {
      pastColumnHeader = true
      continue
    }

    // Try to match a transaction line
    const m = TXN_LINE_RE.exec(trimmed)
    if (m) {
      // Finalise previous transaction before starting a new one
      pushCurrent()

      const rawAmount = parsePdfAmount(m[3])
      if (rawAmount === null) continue

      const absAmount = Math.abs(rawAmount)
      const type: "expense" | "credit" = rawAmount < 0 ? "expense" : "credit"

      current = {
        date: m[1],
        payee: (m[5] ?? "").trim() || "Unknown",
        amount: absAmount,
        type,
        amountFinalised: absAmount > 0,
      }
      continue
    }

    // Not a transaction line — handle as continuation or fee detail
    if (!current) continue

    // Special case: standalone fee amount line (Fold subscription fee displayed as $0)
    // e.g. "($10.00) Fold+ Subscription"
    if (!current.amountFinalised) {
      const feeMatch = FEE_DETAIL_RE.exec(trimmed)
      if (feeMatch) {
        const feeAmount = parsePdfAmount(feeMatch[1])
        if (feeAmount !== null && Math.abs(feeAmount) > 0) {
          current.amount = Math.abs(feeAmount)
          current.type = feeAmount < 0 ? "expense" : "credit"
          current.amountFinalised = true
          continue
        }
      }
    }

    // Merchant name continuation — append to current payee
    current.payee = `${current.payee} ${trimmed}`.trim()
  }

  // Push any trailing transaction
  pushCurrent()

  return { transactions, meta }
}
