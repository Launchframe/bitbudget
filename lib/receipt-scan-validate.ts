/** Max upload size for receipt scan (DoS / OpenAI cost control). */
export const RECEIPT_SCAN_MAX_BYTES = 12 * 1024 * 1024

export type ResolvedReceiptKind =
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/heic"

/**
 * Resolve file kind from magic bytes (do not trust client Content-Type alone).
 */
export function resolveReceiptFileKind(buffer: Buffer): ResolvedReceiptKind | null {
  if (buffer.length < 12) return null
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf"
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg"
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png"
  }
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp"
  }
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii")
    if (/^heic|^heix|^heim|^heis|^mif1|^msf1/i.test(brand)) {
      return "image/heic"
    }
  }
  return null
}

export function normalizeScanExtraction(raw: Record<string, unknown>): {
  payee: string
  amount: string
  date: string
} {
  const payee =
    typeof raw.payee === "string" ? raw.payee.replace(/\s+/g, " ").trim().slice(0, 500) : ""

  let amount = ""
  const a = raw.amount
  if (typeof a === "number" && Number.isFinite(a) && a >= 0) {
    amount = String(a)
  } else if (typeof a === "string") {
    const t = a.trim().replace(/[$,]/g, "")
    if (/^\d+(\.\d{1,2})?$/.test(t)) amount = t
  }

  let date = ""
  if (typeof raw.date === "string") {
    const d = raw.date.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) date = d
  }

  return { payee, amount, date }
}
