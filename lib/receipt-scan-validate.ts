export const RECEIPT_EXTRACTION_PROMPT = `You are a receipt parser. Extract the following from this receipt:
1. payee — the merchant/store/company name
2. amount — the total amount paid (number only, no currency symbol)
3. date — the transaction date in YYYY-MM-DD format
4. confidence — a number from 0.0 to 1.0 reflecting how clearly you could read the receipt (1.0 = all fields clearly legible, 0.0 = unreadable or heavily damaged)

Respond ONLY with valid JSON: {"payee":"...","amount":"...","date":"...","confidence":0.9}
If you cannot determine a field, use an empty string for that field.`

/** Confidence threshold below which the New Transaction dialog shows a "please double-check" banner. */
export const RECEIPT_SCAN_LOW_CONFIDENCE_THRESHOLD = 0.8

/** Max upload size for receipt scan (DoS / OpenAI cost control). */
export const RECEIPT_SCAN_MAX_BYTES = 12 * 1024 * 1024

/** Internal model ID used for receipt extraction. */
export const RECEIPT_EXTRACTION_MODEL_ID = "gpt-4o-mini"

/**
 * Friendly display name for an AI model ID.
 * Only maps known extraction models; falls back to the raw ID.
 */
export function formatModelDisplayName(modelId: string): string {
  const known: Record<string, string> = {
    "gpt-4o-mini": "GPT-4o mini",
    "gpt-4o": "GPT-4o",
    "gpt-4-turbo": "GPT-4 Turbo",
    "gpt-4-vision-preview": "GPT-4 Vision",
  }
  return known[modelId] ?? modelId
}

/** Stats from a receipt or statement scan — safe to surface to the user. */
export interface ReceiptScanStats {
  /** Friendly display name of the AI model used, e.g. "GPT-4o mini". */
  model: string
  /** Wall-clock time for the AI extraction step in milliseconds. */
  processingMs: number
  /** Whether the source was a photo or a PDF document. */
  inputType: "photo" | "pdf"
  /** File size in bytes. */
  fileSizeBytes: number
  /** Model-reported extraction confidence (0–1). */
  extractionConfidence: number
  /** Envelope matching confidence (0–1), or null if no match was found. */
  envelopeMatchConfidence: number | null
}

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
  /** Model-reported confidence (0–1) for how clearly it could read the receipt. */
  extractionConfidence: number
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

  // Model-reported confidence: clamp to [0,1]; fall back to field-completeness heuristic.
  let extractionConfidence: number
  const rawConf = raw.confidence
  const parsedConfidence =
    typeof rawConf === "number"
      ? rawConf
      : typeof rawConf === "string" && rawConf.trim() !== ""
        ? Number(rawConf.trim())
        : Number.NaN
  if (Number.isFinite(parsedConfidence)) {
    extractionConfidence = Math.max(0, Math.min(1, parsedConfidence))
  } else {
    // Heuristic: each present field contributes; amount is most important.
    const fieldScore = (payee ? 0.3 : 0) + (amount ? 0.5 : 0) + (date ? 0.2 : 0)
    extractionConfidence = fieldScore
  }

  return { payee, amount, date, extractionConfidence }
}

export function isLowConfidenceReceiptScan(confidence: number): boolean {
  return confidence < RECEIPT_SCAN_LOW_CONFIDENCE_THRESHOLD
}
