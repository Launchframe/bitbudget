import { parseCSVLine, parseDate } from "@/lib/csv"
import { isImportPeriodFuture } from "@/lib/income-import"
import { todayUtcIso } from "@/lib/transaction-visibility"

export interface IncomeCsvRow {
  date: string
  amount: number
  source?: string
}

export interface IncomeCsvMonthBucket {
  periodKey: string
  amount: number
  source?: string
  rowCount: number
}

export interface IncomeCsvParseResult {
  buckets: IncomeCsvMonthBucket[]
  totalRows: number
  skippedRows: number
}

function parseAmount(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === "") return null
  const n = parseFloat(raw.replace(/[$,\s]/g, ""))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100) / 100
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/['"]/g, "").trim()
}

function findColumnIndex(headers: string[], names: readonly string[]): number {
  for (const name of names) {
    const idx = headers.findIndex((h) => h === name)
    if (idx >= 0) return idx
  }
  return -1
}

/** Parse a simple income CSV (date, amount, optional source) into validated rows. */
export function parseIncomeCsvRows(text: string): { rows: IncomeCsvRow[]; totalRows: number; skippedRows: number } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) {
    throw new Error("CSV file is empty or has no data rows.")
  }

  const headers = parseCSVLine(lines[0]!).map(normalizeHeader)
  const dateIdx = findColumnIndex(headers, ["date"])
  const amountIdx = findColumnIndex(headers, ["amount", "income", "pay"])
  const sourceIdx = findColumnIndex(headers, ["source", "label", "payee", "name", "employer", "description"])

  if (dateIdx === -1 || amountIdx === -1) {
    throw new Error("CSV must include Date and Amount columns.")
  }

  const rows: IncomeCsvRow[] = []
  let skippedRows = 0

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]!)
    if (cols.length <= Math.max(dateIdx, amountIdx)) {
      skippedRows++
      continue
    }

    const dateStr = parseDate(cols[dateIdx]!.trim())
    if (!dateStr) {
      skippedRows++
      continue
    }

    const amount = parseAmount(cols[amountIdx])
    if (amount == null) {
      skippedRows++
      continue
    }

    const sourceRaw = sourceIdx >= 0 ? cols[sourceIdx]?.trim() : ""
    rows.push({
      date: dateStr,
      amount,
      ...(sourceRaw ? { source: sourceRaw } : {}),
    })
  }

  return { rows, totalRows: lines.length - 1, skippedRows }
}

/** Group parsed rows into calendar month buckets (YYYY-MM). Amounts are summed per month. */
export function bucketIncomeCsvByMonth(rows: readonly IncomeCsvRow[]): IncomeCsvMonthBucket[] {
  const byMonth = new Map<
    string,
    { amount: number; rowCount: number; sourceWeights: Map<string, number> }
  >()

  for (const row of rows) {
    const periodKey = row.date.slice(0, 7)
    const existing = byMonth.get(periodKey) ?? { amount: 0, rowCount: 0, sourceWeights: new Map() }
    existing.amount = Math.round((existing.amount + row.amount) * 100) / 100
    existing.rowCount += 1
    if (row.source) {
      existing.sourceWeights.set(row.source, (existing.sourceWeights.get(row.source) ?? 0) + row.amount)
    }
    byMonth.set(periodKey, existing)
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodKey, data]) => {
      let source: string | undefined
      if (data.sourceWeights.size === 1) {
        source = [...data.sourceWeights.keys()][0]
      } else if (data.sourceWeights.size > 1) {
        let best = ""
        let bestWeight = -1
        for (const [label, weight] of data.sourceWeights) {
          if (weight > bestWeight) {
            best = label
            bestWeight = weight
          }
        }
        source = best
      }
      return {
        periodKey,
        amount: data.amount,
        ...(source ? { source } : {}),
        rowCount: data.rowCount,
      }
    })
}

export function parseIncomeCsv(text: string, now = new Date()): IncomeCsvParseResult {
  const { rows, totalRows, skippedRows: parseSkipped } = parseIncomeCsvRows(text)
  const today = todayUtcIso(now)
  const importableRows = rows.filter((row) => row.date <= today)
  const futureDateSkipped = rows.length - importableRows.length
  const allBuckets = bucketIncomeCsvByMonth(importableRows)
  const buckets = allBuckets.filter((b) => !isImportPeriodFuture(b.periodKey, now))
  const futureMonthSkipped = allBuckets.length - buckets.length
  return {
    buckets,
    totalRows,
    skippedRows: parseSkipped + futureDateSkipped + futureMonthSkipped,
  }
}

/** Convert month buckets to staged calendar entries for the income importer dialog. */
export function incomeCsvBucketsToStagedEntries(
  buckets: readonly IncomeCsvMonthBucket[],
): Array<{ periodKey: string; amount: number; source?: string; kind: "month" }> {
  return buckets.map((b) => ({
    periodKey: b.periodKey,
    amount: b.amount,
    ...(b.source ? { source: b.source } : {}),
    kind: "month" as const,
  }))
}

/** Suggested scroll year: most recent month in the import. */
export function latestYearFromBuckets(buckets: readonly IncomeCsvMonthBucket[]): number {
  if (buckets.length === 0) return new Date().getUTCFullYear()
  const last = buckets[buckets.length - 1]!
  return Number.parseInt(last.periodKey.slice(0, 4), 10)
}
