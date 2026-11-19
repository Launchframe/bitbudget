import {
  RECEIPT_EXTRACTION_PROMPT,
  RECEIPT_EXTRACTION_MODEL_ID,
  normalizeScanExtraction,
} from "@/lib/receipt-scan-validate"
import {
  ITEMIZED_PDF_TEXT_CHARS,
  ITEMIZED_RECEIPT_EXTRACTION_PROMPT,
  ITEMIZED_RECEIPT_MAX_TOKENS,
} from "@/lib/shopping-receipt"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

export interface ParsedReceipt {
  payee: string
  amount: string
  date: string
  extractionConfidence: number
  /** Raw model ID used for extraction, e.g. "gpt-4o-mini". */
  model: string
  /** Wall-clock time for the AI extraction call in milliseconds. */
  processingMs: number
}

export async function parseReceiptText(text: string): Promise<ParsedReceipt> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured")

  const start = Date.now()
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: RECEIPT_EXTRACTION_MODEL_ID,
      messages: [
        {
          role: "user",
          content: `${RECEIPT_EXTRACTION_PROMPT}\n\nReceipt text:\n${text.slice(0, 4000)}`,
        },
      ],
      max_tokens: 200,
      temperature: 0,
    }),
  })
  const processingMs = Date.now() - start

  const body = (await res.json().catch(() => ({}))) as
    | { choices?: Array<{ message?: { content?: string } }> }
    | { error?: { message?: string } }

  if (!res.ok) {
    const message = "error" in body ? body.error?.message : undefined
    if (res.status === 429) {
      throw new Error(
        `OpenAI rate limit exceeded (429). ${message || "Try again in a minute or check your API tier/usage."}`,
      )
    }
    throw new Error(`OpenAI API error: ${res.status}. ${message || ""}`.trim())
  }

  const responseText =
    "choices" in body ? body.choices?.[0]?.message?.content?.trim() ?? "" : ""
  const jsonMatch = responseText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error("Could not parse response.")
  const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  return { ...normalizeScanExtraction(raw), model: RECEIPT_EXTRACTION_MODEL_ID, processingMs }
}

export async function parseItemizedReceiptText(text: string): Promise<unknown> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured")

  const start = Date.now()
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: RECEIPT_EXTRACTION_MODEL_ID,
      messages: [
        {
          role: "user",
          content: `${ITEMIZED_RECEIPT_EXTRACTION_PROMPT}\n\nReceipt text:\n${text.slice(0, ITEMIZED_PDF_TEXT_CHARS)}`,
        },
      ],
      max_tokens: ITEMIZED_RECEIPT_MAX_TOKENS,
      temperature: 0,
    }),
  })
  void start
  if (!res.ok) {
    throw new Error("Could not read this receipt")
  }
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const responseText = body.choices?.[0]?.message?.content?.trim() ?? ""
  if (responseText.length >= ITEMIZED_RECEIPT_MAX_TOKENS * 3) {
    return { truncated: true, lines: [] }
  }
  const jsonMatch = responseText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error("Could not parse response.")
  return JSON.parse(jsonMatch[0]) as unknown
}
