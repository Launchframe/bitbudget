/**
 * Transaction CSV export: filename building and CSV formatting.
 * Used by the Transactions page; filter scope is applied before calling these helpers.
 */

// Heuristic check for values that are likely plain numeric or currency literals,
// e.g. "123", "-42.50", "$1,234.00", "-$42.50", "- $42.50".
function isProbablyNumericOrCurrency(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false

  // Plain integer/decimal with optional sign.
  if (/^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) return true

  // Currency with optional sign, optional "$", optional spaces, optional thousands separators.
  // Examples matched: "$123", "-$42.50", "- $42.50", "+$1,234.00"
  if (/^[+-]?\s*\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?$/.test(trimmed)) return true

  return false
}

export function escapeCsvField(value: string): string {
  // Prevent spreadsheet formula injection by neutralizing leading formula characters.
  // If the value (after any leading whitespace/control characters) starts with =, +, - or @,
  // and is not a plain numeric/currency literal, prefix it with a single quote so that Excel
  // treats it as a text value rather than a formula.
  const leadingStripped = value.replace(/^[\s\x00-\x1F]+/, "")
  const startsLikeFormula = /^[=+\-@]/.test(leadingStripped)
  const shouldNeutralize = startsLikeFormula && !isProbablyNumericOrCurrency(value)
  const sanitized = shouldNeutralize ? `'${value}` : value
  if (!/[\r\n",]/.test(sanitized)) return sanitized
  return `"${sanitized.replace(/"/g, '""')}"`
}

export interface BuildExportFilenameOptions {
  /** Date stamp for the filename (YYYY-MM-DD). */
  stampDate: string
  /** True when payee search filter is active. */
  hasPayeeSearch?: boolean
  /** Active type filter when not "all". */
  typeFilter?: "expense" | "credit" | "income"
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
/** Max envelope/tag parts to include in filename to avoid very long names on some filesystems. */
const MAX_ENV_PARTS = 3
const MAX_TAG_PARTS = 3
const MAX_FILENAME_LEN = 200

function sanitizeFilenamePart(name: string, maxLen: number): string {
  return name
    .replace(/[^a-zA-Z0-9_-]/g, "-")
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
    const parts = envelopeNames
      .map((n) => sanitizeFilenamePart(n, ENV_NAME_MAX_LEN))
      .filter(Boolean)
      .slice(0, MAX_ENV_PARTS)
    if (parts.length > 0) {
      const suffix = envelopeNames.length > MAX_ENV_PARTS ? "-and-more" : ""
      name += `-envelope-${parts.join("-")}${suffix}`
    }
  }
  if (tagNames?.length) {
    const parts = tagNames
      .map((t) => sanitizeFilenamePart(t, TAG_MAX_LEN))
      .filter(Boolean)
      .slice(0, MAX_TAG_PARTS)
    if (parts.length > 0) {
      const suffix = tagNames.length > MAX_TAG_PARTS ? "-and-more" : ""
      name += `-tags-${parts.join("-")}${suffix}`
    }
  }
  if (startDate) name += `-from-${startDate}`
  if (endDate) name += `-to-${endDate}`
  const withExt = `${name}.csv`
  if (withExt.length > MAX_FILENAME_LEN) {
    return withExt.slice(0, MAX_FILENAME_LEN - 4) + ".csv"
  }
  return withExt
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
  return [header, ...body].join("\r\n")
}
