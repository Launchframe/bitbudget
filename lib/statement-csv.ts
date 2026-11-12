/**
 * Bank statement CSV parser.
 *
 * Supports Fold debit card statement format:
 *   Headers: "Transaction ID", "Settlement Date", "Description", "Amount"
 *   Date format: "YYYY-MM-DD HH:mm:ss+ZZ:ZZ"
 *   Amount: negative = expense, positive = credit
 *   Trailing metadata rows (Starting/Ending balance, account info, legal text) are filtered.
 *
 * Returns ParsedTransaction[] compatible with the existing CSV import pipeline
 * (`envelopeName` is always "Uncategorized" — statement files have no category column).
 */

import { parseCSVLine } from "@/lib/csv"
import type { ParsedTransaction } from "@/lib/csv"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(s: string): boolean {
  return UUID_RE.test(s)
}

/** Extract YYYY-MM-DD from any date string that begins with an ISO date component. */
export function parseFoldDate(dateStr: string): string | null {
  const m = dateStr.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

/** Detect Fold statement CSV format from normalised header array. */
export function isFoldStatementCsv(headers: string[]): boolean {
  const has = (re: RegExp) => headers.some(h => re.test(h))
  return (
    has(/transaction.?id/i) &&
    has(/settlement.?date/i) &&
    has(/^description$/i) &&
    has(/^amount$/i)
  )
}

export interface StatementParseResult {
  transactions: ParsedTransaction[]
  /** Total rows in the file (header excluded). */
  totalRows: number
  /** Rows skipped due to parse errors or metadata detection. */
  skippedRows: number
  /** Detected format name. */
  format: "fold_csv"
  /** High-confidence institution display name derived from the format. null if unrecognised. */
  institutionName: string | null
}

/**
 * Parse a Fold debit card statement CSV file into normalised transactions.
 *
 * Throws if the file does not look like a Fold statement CSV.
 */
export function parseFoldStatementCsv(text: string): StatementParseResult {
  const rawLines = text.split("\n")
  const lines = rawLines.filter(l => l.trim())

  if (lines.length < 2) {
    throw new Error("File is empty or has no data rows.")
  }

  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/['"]/g, "").trim())

  if (!isFoldStatementCsv(headers)) {
    throw new Error(
      "This doesn't look like a Fold statement CSV. " +
        "Expected columns: Transaction ID, Settlement Date, Description, Amount.",
    )
  }

  const idIdx = headers.findIndex(h => /transaction.?id/i.test(h))
  const dateIdx = headers.findIndex(h => /settlement.?date/i.test(h))
  const descIdx = headers.findIndex(h => /^description$/i.test(h))
  const amountIdx = headers.findIndex(h => /^amount$/i.test(h))

  const transactions: ParsedTransaction[] = []
  let skipped = 0

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])

    // Fold transaction rows always have at least 4 columns; metadata rows have 2 or fewer.
    if (cols.length < 4) {
      skipped++
      continue
    }

    // The first column of a real transaction row is a UUID; metadata rows are not.
    if (idIdx >= 0 && !isUuid(cols[idIdx])) {
      skipped++
      continue
    }

    const dateStr = parseFoldDate(cols[dateIdx] ?? "")
    if (!dateStr) {
      skipped++
      continue
    }

    const rawAmount = parseFloat((cols[amountIdx] ?? "").replace(/[$,]/g, ""))
    if (isNaN(rawAmount)) {
      skipped++
      continue
    }

    const payee = (cols[descIdx] ?? "").trim() || "Unknown"
    const type: "expense" | "credit" = rawAmount < 0 ? "expense" : "credit"
    const amount = Math.abs(rawAmount)

    transactions.push({
      date: dateStr,
      payee,
      amount,
      type,
      envelopeName: "Uncategorized",
      notes: null,
    })
  }

  return {
    transactions,
    totalRows: lines.length - 1,
    skippedRows: skipped,
    format: "fold_csv",
    institutionName: "Fold",
  }
}

/**
 * Dispatcher that tries all known statement CSV formats in order.
 * Returns the first successful parse result, or null if no format matches.
 * Add new bank format parsers here as they are implemented.
 */
export function tryParseStatementCsv(text: string): StatementParseResult | null {
  try {
    return parseFoldStatementCsv(text)
  } catch {
    // not a Fold statement — try next format (none yet)
  }
  return null
}
