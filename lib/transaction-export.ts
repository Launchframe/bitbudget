/**
 * Transaction CSV export: filename building and CSV formatting.
 * Used by the Transactions page; filter scope is applied before calling these helpers.
 */

export function escapeCsvField(value: string): string {
  if (!/[\n",]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

export interface BuildExportFilenameOptions {
  /** Date stamp for the filename (YYYY-MM-DD). */
  stampDate: string
  /** True when payee search filter is active. */
  hasPayeeSearch?: boolean
  /** Active type filter when not "all". */
  typeFilter?: "expense" | "credit"
  /** Envelope names when envelope filter is active (will be sanitized for filename). */
  envelopeNames?: string[]
  /** Tag names when tag filter is active (will be sanitized for filename). */
  tagNames?: string[]
  /** Start date when date range filter is active (YYYY-MM-DD). */
  startDate?: string
  /** End date when date range filter is active (YYYY-MM-DD). */
  endDate?: string
}

const ENV_NAME_MAX_LEN = 20
const TAG_MAX_LEN = 15

function sanitizeFilenamePart(name: string, maxLen: number): string {
  return name
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, maxLen)
    .replace(/^-|-$/g, "")
}

export function buildExportFilename(options: BuildExportFilenameOptions): string {
  const { stampDate, hasPayeeSearch, typeFilter, envelopeNames, tagNames, startDate, endDate } = options
  let name = `bitbudget-transactions-${stampDate}`
  if (hasPayeeSearch) name += "-payee-search"
  if (typeFilter) name += `-${typeFilter}`
  if (envelopeNames?.length) {
    const parts = envelopeNames.map((n) => sanitizeFilenamePart(n, ENV_NAME_MAX_LEN)).filter(Boolean)
    if (parts.length > 0) name += `-envelope-${parts.join("-")}`
  }
  if (tagNames?.length) {
    const parts = tagNames.map((t) => sanitizeFilenamePart(t, TAG_MAX_LEN)).filter(Boolean)
    if (parts.length > 0) name += `-tags-${parts.join("-")}`
  }
  if (startDate) name += `-from-${startDate}`
  if (endDate) name += `-to-${endDate}`
  return `${name}.csv`
}

export interface TransactionExportRow {
  type: string
  date: string
  payee: string
  amountFormatted: string
  notes: string
  envelopeName: string
  tags: string
}

const CSV_HEADER = "type,date,payee,amount,notes,envelope,tags"

export function buildTransactionsCsv(rows: TransactionExportRow[]): string {
  const header = CSV_HEADER
  const body = rows.map((r) =>
    [
      r.type,
      r.date,
      escapeCsvField(r.payee),
      escapeCsvField(r.amountFormatted),
      escapeCsvField(r.notes),
      escapeCsvField(r.envelopeName),
      escapeCsvField(r.tags),
    ].join(",")
  )
  return [header, ...body].join("\n")
}
