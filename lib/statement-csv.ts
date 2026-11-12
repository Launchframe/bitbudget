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

import { parseCSVLine, parseDate, type ParsedTransaction } from "@/lib/csv"

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
  format: "fold_csv" | "chase_csv" | "coinbase_csv"
  /** High-confidence institution display name derived from the format. null if unrecognised. */
  institutionName: string | null
  /**
   * Exchange buys, sells, and coin transfers. They are not budget rows:
   * a bitcoin purchase is not spending, and a sale is not income.
   */
  ignoredTrades?: number
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
 */
export function tryParseStatementCsv(text: string): StatementParseResult | null {
  const parsers = [parseFoldStatementCsv, parseChaseStatementCsv, parseCoinbaseHistoryCsv]
  for (const parse of parsers) {
    try {
      return parse(text)
    } catch {
      // header does not match this format
    }
  }
  return null
}

function normalizedHeaders(headerLine: string): string[] {
  return parseCSVLine(headerLine).map((h) => h.toLowerCase().replace(/['"]/g, "").trim())
}

function hasHeader(headers: string[], re: RegExp): boolean {
  return headers.some((h) => re.test(h))
}

function statementDay(value: string): string | null {
  const trimmed = value.trim()
  return parseDate(trimmed) ?? parseFoldDate(trimmed)
}

/** Chase checking/savings download: Posting Date, Description, Amount, Type. */
export function isChaseStatementCsv(headers: string[]): boolean {
  return (
    hasHeader(headers, /posting date/) &&
    hasHeader(headers, /^description$/) &&
    hasHeader(headers, /^amount$/) &&
    (hasHeader(headers, /^type$/) || hasHeader(headers, /^details$/))
  )
}

export function parseChaseStatementCsv(text: string): StatementParseResult {
  const lines = text.split("\n").filter((l) => l.trim())
  if (lines.length < 2) throw new Error("File is empty or has no data rows.")
  const headers = normalizedHeaders(lines[0])
  if (!isChaseStatementCsv(headers)) {
    throw new Error(
      "This doesn't look like a Chase statement CSV. Expected columns: Posting Date, Description, Amount, Type.",
    )
  }
  const dateIdx = headers.findIndex((h) => /posting date/.test(h))
  const descIdx = headers.findIndex((h) => h === "description")
  const amountIdx = headers.findIndex((h) => h === "amount")
  const typeIdx = headers.findIndex((h) => h === "type")

  const transactions: ParsedTransaction[] = []
  let skipped = 0
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    const date = statementDay(cols[dateIdx] ?? "")
    const rawAmount = Number.parseFloat((cols[amountIdx] ?? "").replace(/[$,]/g, ""))
    const ledger = chaseLedger(rawAmount, typeIdx >= 0 ? (cols[typeIdx] ?? "") : "")
    const payee = (cols[descIdx] ?? "").trim()
    if (!date || !ledger || !payee) {
      skipped++
      continue
    }
    transactions.push({
      date,
      payee,
      amount: ledger.amount,
      type: ledger.type,
      envelopeName: "Uncategorized",
      notes: null,
    })
  }
  return {
    transactions,
    totalRows: lines.length - 1,
    skippedRows: skipped,
    format: "chase_csv",
    institutionName: "Chase",
  }
}

function chaseLedger(
  amount: number,
  typeCell: string,
): { type: "expense" | "credit"; amount: number } | null {
  if (!Number.isFinite(amount) || amount === 0) return null
  const kind = typeCell.trim().toLowerCase()
  const abs = Math.abs(amount)
  if (kind.startsWith("debit") || kind === "sale") return { type: "expense", amount: abs }
  if (kind.startsWith("credit") || kind.includes("deposit")) return { type: "credit", amount: abs }
  return amount < 0 ? { type: "expense", amount: abs } : { type: "credit", amount: abs }
}

/** Coinbase account history. Fiat deposits and withdrawals become budget rows. */
export function isCoinbaseHistoryCsv(headers: string[]): boolean {
  return (
    hasHeader(headers, /^timestamp$/) &&
    hasHeader(headers, /transaction type/) &&
    hasHeader(headers, /^asset$/) &&
    hasHeader(headers, /quantity transacted/)
  )
}

export function parseCoinbaseHistoryCsv(text: string): StatementParseResult {
  const lines = text.split("\n").filter((l) => l.trim())
  if (lines.length < 2) throw new Error("File is empty or has no data rows.")
  const headers = normalizedHeaders(lines[0])
  if (!isCoinbaseHistoryCsv(headers)) {
    throw new Error(
      "This doesn't look like a Coinbase history CSV. Expected columns: Timestamp, Transaction Type, Asset, Quantity Transacted.",
    )
  }
  const dateIdx = headers.findIndex((h) => h === "timestamp")
  const typeIdx = headers.findIndex((h) => /transaction type/.test(h))
  const assetIdx = headers.findIndex((h) => h === "asset")
  const qtyIdx = headers.findIndex((h) => /quantity transacted/.test(h))
  const notesIdx = headers.findIndex((h) => h === "notes")

  const transactions: ParsedTransaction[] = []
  let skipped = 0
  let ignoredTrades = 0
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    const date = statementDay(cols[dateIdx] ?? "")
    const asset = (cols[assetIdx] ?? "").trim()
    const txType = (cols[typeIdx] ?? "").trim()
    const quantity = Number.parseFloat((cols[qtyIdx] ?? "").replace(/[$,]/g, ""))
    const classified = coinbaseLedger(txType, asset, quantity)
    if (!date || classified == null) {
      skipped++
      continue
    }
    if (classified === "trade") {
      ignoredTrades++
      continue
    }
    const note = notesIdx >= 0 ? (cols[notesIdx] ?? "").trim() : ""
    transactions.push({
      date,
      payee: note || `${txType} ${asset}`.trim(),
      amount: classified.amount,
      type: classified.type,
      envelopeName: "Uncategorized",
      notes: null,
    })
  }
  return {
    transactions,
    totalRows: lines.length - 1,
    skippedRows: skipped,
    format: "coinbase_csv",
    institutionName: "Coinbase",
    ignoredTrades,
  }
}

function coinbaseLedger(
  txType: string,
  asset: string,
  quantity: number,
): { type: "expense" | "credit"; amount: number } | "trade" | null {
  if (!Number.isFinite(quantity) || quantity === 0) return null
  const kind = txType.trim().toLowerCase()
  const usd = asset.trim().toUpperCase() === "USD"
  if (usd && kind.includes("deposit")) return { type: "credit", amount: Math.abs(quantity) }
  if (usd && (kind.includes("withdraw") || kind === "send")) {
    return { type: "expense", amount: Math.abs(quantity) }
  }
  if (!usd) return "trade"
  return null
}
