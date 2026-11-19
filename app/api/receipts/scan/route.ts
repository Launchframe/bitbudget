import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { premiumForbiddenResponse, requirePremiumOrTrial } from "@/lib/subscription"
import { matchEnvelope } from "@/lib/envelope-matcher"
import { parseReceiptText, parseItemizedReceiptText } from "@/lib/receipt-parser"
import {
  RECEIPT_EXTRACTION_PROMPT,
  RECEIPT_EXTRACTION_MODEL_ID,
  RECEIPT_SCAN_MAX_BYTES,
  formatModelDisplayName,
  normalizeScanExtraction,
  resolveReceiptFileKind,
} from "@/lib/receipt-scan-validate"
import {
  ITEMIZED_RECEIPT_EXTRACTION_PROMPT,
  ITEMIZED_RECEIPT_MAX_TOKENS,
  parseItemizedModelOutput,
} from "@/lib/shopping-receipt"
import { isFoldStatementText, parseFoldPdfText } from "@/lib/fold-pdf-parser"

/** Native canvas + pdf-parse; must not run on Edge. */
export const runtime = "nodejs"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

function httpStatusFromError(err: unknown): number | undefined {
  if (err !== null && typeof err === "object" && "status" in err) {
    const s = (err as { status: unknown }).status
    if (typeof s === "number" && s >= 100 && s < 600) return s
  }
  return undefined
}

interface ExtractionResult {
  payee: string
  amount: string
  date: string
  extractionConfidence: number
  model: string
  processingMs: number
}

/** Caller must ensure `apiKey` is set (POST handler checks env before calling). */
async function extractFromImage(
  base64: string,
  mimeType: string,
  apiKey: string,
): Promise<ExtractionResult> {
  const start = Date.now()
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: RECEIPT_EXTRACTION_MODEL_ID,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: RECEIPT_EXTRACTION_PROMPT },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        },
      ],
      max_tokens: 200,
      temperature: 0,
    }),
  })
  const processingMs = Date.now() - start

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `OpenAI API error: ${res.status}`)
  }

  const data = await res.json()
  const text = data.choices?.[0]?.message?.content?.trim() ?? ""
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error("Could not parse model response")

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonMatch[0]) as unknown
  } catch {
    throw new Error("Invalid JSON in model response")
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Unexpected model response shape")
  }
  return {
    ...normalizeScanExtraction(parsed as Record<string, unknown>),
    model: RECEIPT_EXTRACTION_MODEL_ID,
    processingMs,
  }
}

async function extractItemizedFromImage(
  base64: string,
  mimeType: string,
  apiKey: string,
): Promise<unknown> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: RECEIPT_EXTRACTION_MODEL_ID,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: ITEMIZED_RECEIPT_EXTRACTION_PROMPT },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        },
      ],
      max_tokens: ITEMIZED_RECEIPT_MAX_TOKENS,
      temperature: 0,
    }),
  })
  if (!res.ok) {
    throw new Error("Could not read this receipt")
  }
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
  const text = data.choices?.[0]?.message?.content?.trim() ?? ""
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error("Could not parse model response")
  return JSON.parse(jsonMatch[0]) as unknown
}

function noStoreJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store, private" } })
}

/** Loads canvas shims then pdf-parse only when needed (image uploads skip this). */
async function extractTextFromPdfBuffer(buffer: Buffer): Promise<string> {
  const { initReceiptPdfParseEnvironment } = await import("@/lib/pdfjs-server-globals")
  await initReceiptPdfParseEnvironment()
  const { PDFParse } = await import("pdf-parse")
  const parser = new PDFParse({ data: buffer })
  try {
    const textResult = await parser.getText()
    return textResult.text ?? ""
  } finally {
    await parser.destroy()
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // JSON / empty probes (e.g. e2e fetchJsonInPage) are not multipart uploads.
  const contentType = req.headers.get("content-type") ?? ""
  if (!contentType.includes("multipart/form-data")) {
    if (!(await requirePremiumOrTrial(session.user.id))) {
      return premiumForbiddenResponse("Receipt scanning requires premium or an active premium trial")
    }
    return NextResponse.json({ error: "No file provided" }, { status: 400 })
  }

  try {
    const formData = await req.formData()
    const file = formData.get("file") as File | null
    const itemizedMode = String(formData.get("mode") ?? "") === "itemized"
    if (itemizedMode) {
      const consent = String(formData.get("cloudConsent") ?? "")
      if (consent !== "1" && consent !== "true") {
        return noStoreJson(
          { error: "Confirm that this receipt may be processed in the cloud before uploading." },
          400,
        )
      }
    }
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }
    if (file.size > RECEIPT_SCAN_MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${RECEIPT_SCAN_MAX_BYTES / (1024 * 1024)} MB.` },
        { status: 413 },
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    if (buffer.length === 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 })
    }
    const kind = resolveReceiptFileKind(buffer)
    if (!kind) {
      return NextResponse.json(
        { error: "Unrecognized file type. Upload a PDF or image (JPEG, PNG, WebP)." },
        { status: 400 },
      )
    }

    // ── PDF: check for Fold statement first (no premium / OpenAI needed) ──
    if (kind === "application/pdf") {
      let text = ""
      try {
        text = (await extractTextFromPdfBuffer(buffer)).trim()
      } catch (extractErr) {
        // E2E fixtures may be minimal/invalid PDFs; fall through to deterministic mock receipt.
        if (process.env.E2E_TEST !== "true") {
          throw extractErr
        }
      }
      if (!text && process.env.E2E_TEST !== "true") {
        return NextResponse.json({ error: "Could not extract text from PDF" }, { status: 422 })
      }

      if (text && isFoldStatementText(text)) {
        const stmtResult = parseFoldPdfText(text)
        if (stmtResult.transactions.length === 0) {
          return NextResponse.json(
            { error: "No transactions found in this statement PDF." },
            { status: 422 },
          )
        }
        return NextResponse.json({
          type: "statement",
          transactions: stmtResult.transactions,
          meta: stmtResult.meta,
          format: "fold_pdf",
        })
      }

      // Not a statement — fall through to receipt processing (requires premium + OpenAI)
      if (!(await requirePremiumOrTrial(session.user.id))) {
        return premiumForbiddenResponse("Receipt scanning requires premium or an active premium trial")
      }
      if (!OPENAI_API_KEY) {
        return NextResponse.json(
          { error: "Receipt scanning is not configured. Set OPENAI_API_KEY." },
          { status: 503 },
        )
      }
      if (process.env.E2E_TEST === "true") {
        if (itemizedMode) {
          return noStoreJson(itemizedE2eMock())
        }
        return e2eMockReceiptResponse(session.user.id, {
          fileSizeBytes: buffer.length,
          inputType: "pdf",
        })
      }
      if (!text) {
        return NextResponse.json({ error: "Could not extract text from PDF" }, { status: 422 })
      }
      if (itemizedMode) {
        const raw = await parseItemizedReceiptText(text)
        return noStoreJson({
          type: "itemized_receipt",
          ...parseItemizedModelOutput(raw),
          model: formatModelDisplayName(RECEIPT_EXTRACTION_MODEL_ID),
        })
      }
      const result = await parseReceiptText(text)
      return NextResponse.json(
        await buildReceiptResponse(session.user.id, result, { fileSizeBytes: buffer.length, inputType: "pdf" }),
      )
    }

    // ── Image: always receipt path (premium + OpenAI) ──
    if (!(await requirePremiumOrTrial(session.user.id))) {
      return premiumForbiddenResponse("Receipt scanning requires premium or an active premium trial")
    }
    if (!OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Receipt scanning is not configured. Set OPENAI_API_KEY." },
        { status: 503 },
      )
    }
    if (process.env.E2E_TEST === "true") {
      if (itemizedMode) return noStoreJson(itemizedE2eMock())
      return e2eMockReceiptResponse(session.user.id, {
        fileSizeBytes: buffer.length,
        inputType: "photo",
      })
    }

    if (kind === "image/heic") {
      return NextResponse.json(
        {
          error:
            "HEIC photos are not supported for scanning. Please use Take Photo (JPEG) or export the image as JPEG/PNG.",
        },
        { status: 400 },
      )
    }
    const base64 = buffer.toString("base64")
    if (itemizedMode) {
      const raw = await extractItemizedFromImage(base64, kind, OPENAI_API_KEY)
      return noStoreJson({
        type: "itemized_receipt",
        ...parseItemizedModelOutput(raw),
        model: formatModelDisplayName(RECEIPT_EXTRACTION_MODEL_ID),
      })
    }
    const result = await extractFromImage(base64, kind, OPENAI_API_KEY)
    return NextResponse.json(
      await buildReceiptResponse(session.user.id, result, { fileSizeBytes: buffer.length, inputType: "photo" }),
    )
  } catch (err) {
    console.error("receipt scan error:", err)
    const errorMessage = "Failed to scan receipt. Please try another image or PDF."
    let status = httpStatusFromError(err) ?? 500
    if (status === 500 && err instanceof Error) {
      const msg = err.message.toLowerCase()
      if (msg.includes("network") || msg.includes("timeout") || msg.includes("openai") || msg.includes("fetch")) {
        status = 502
      }
    }
    return NextResponse.json({ error: errorMessage }, { status })
  }
}

async function buildReceiptResponse(
  userId: string,
  result: ExtractionResult,
  opts: { fileSizeBytes: number; inputType: "pdf" | "photo" },
) {
  let suggestedEnvelopeId: string | null = null
  let suggestedEnvelopeName: string | null = null
  let envelopeMatchConfidence = 0

  if (result.payee) {
    const match = await matchEnvelope(userId, result.payee)
    if (match) {
      suggestedEnvelopeId = match.envelopeId
      envelopeMatchConfidence = match.confidence
      const envelope = await prisma.envelope.findUnique({
        where: { id: match.envelopeId },
        select: { name: true },
      })
      suggestedEnvelopeName = envelope?.name ?? null
    }
  }

  return {
    type: "receipt" as const,
    ...result,
    suggestedEnvelopeId,
    suggestedEnvelopeName,
    confidence: envelopeMatchConfidence,
    // Stats for nerds — safe to expose (no infra/hosting details)
    model: formatModelDisplayName(result.model),
    processingMs: result.processingMs,
    inputType: opts.inputType,
    fileSizeBytes: opts.fileSizeBytes,
    envelopeMatchConfidence: suggestedEnvelopeId ? envelopeMatchConfidence : null,
  }
}

/** Deterministic receipt scan for Playwright (see e2e/receipt-scan.prefill.spec.ts). */
const E2E_MOCK_RECEIPT_EXTRACTION: ExtractionResult = {
  payee: "Receipt Scan Café ZZ99",
  amount: "42.50",
  date: "2026-04-01",
  extractionConfidence: 0.92,
  model: RECEIPT_EXTRACTION_MODEL_ID,
  processingMs: 1240,
}

async function e2eMockReceiptResponse(
  userId: string,
  opts: { fileSizeBytes: number; inputType: "pdf" | "photo" },
) {
  return NextResponse.json(await buildReceiptResponse(userId, E2E_MOCK_RECEIPT_EXTRACTION, opts))
}

function itemizedE2eMock() {
  return {
    type: "itemized_receipt" as const,
    ...parseItemizedModelOutput({
      merchant: "Receipt Scan Café ZZ99",
      date: "2026-04-01",
      currency: "USD",
      subtotal: "40.00",
      tax: "2.50",
      discount: "0.00",
      fees: "0.00",
      total: "42.50",
      truncated: false,
      lines: [
        { description: "Coffee", quantity: 1, unit: "each", amount: "4.50", confidence: 0.9 },
        { description: "Groceries", quantity: 1, unit: "each", amount: "38.00", confidence: 0.9 },
      ],
    }),
    model: formatModelDisplayName(RECEIPT_EXTRACTION_MODEL_ID),
  }
}
