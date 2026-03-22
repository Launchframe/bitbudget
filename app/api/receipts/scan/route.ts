import "@/lib/pdfjs-server-globals"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { premiumForbiddenResponse, requirePremium } from "@/lib/subscription"
import { matchEnvelope } from "@/lib/envelope-matcher"
import { parseReceiptText } from "@/lib/receipt-parser"
import { PDFParse } from "pdf-parse"
import {
  RECEIPT_SCAN_MAX_BYTES,
  normalizeScanExtraction,
  resolveReceiptFileKind,
} from "@/lib/receipt-scan-validate"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const EXTRACTION_PROMPT = `You are a receipt parser. Extract the following from this receipt:
1. payee — the merchant/store/company name
2. amount — the total amount paid (number only, no currency symbol)
3. date — the transaction date in YYYY-MM-DD format

Respond ONLY with valid JSON: {"payee":"...","amount":"...","date":"..."}
If you cannot determine a field, use an empty string for that field.`

function httpStatusFromError(err: unknown): number | undefined {
  if (err !== null && typeof err === "object" && "status" in err) {
    const s = (err as { status: unknown }).status
    if (typeof s === "number" && s >= 100 && s < 600) return s
  }
  return undefined
}

/** Caller must ensure `apiKey` is set (POST handler checks env before calling). */
async function extractFromImage(base64: string, mimeType: string, apiKey: string) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: EXTRACTION_PROMPT },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        },
      ],
      max_tokens: 200,
      temperature: 0,
    }),
  })

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
  return normalizeScanExtraction(parsed as Record<string, unknown>)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!(await requirePremium(session.user.id))) {
    return premiumForbiddenResponse("Receipt scanning requires a premium subscription")
  }

  if (!OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "Receipt scanning is not configured. Set OPENAI_API_KEY." },
      { status: 503 },
    )
  }
  const openaiKey = OPENAI_API_KEY

  try {
    const formData = await req.formData()
    const file = formData.get("file") as File | null
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

    let result: { payee: string; amount: string; date: string }

    if (kind === "application/pdf") {
      const parser = new PDFParse({ data: buffer })
      const textResult = await parser.getText()
      await parser.destroy()
      if (!textResult.text?.trim()) {
        return NextResponse.json({ error: "Could not extract text from PDF" }, { status: 422 })
      }
      result = await parseReceiptText(textResult.text)
    } else if (kind.startsWith("image/")) {
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
      result = await extractFromImage(base64, kind, openaiKey)
    } else {
      // This branch should be unreachable because resolveReceiptFileKind only returns
      // "application/pdf" or "image/*" (including "image/heic"). Throwing here makes
      // it explicit that any other value is unsupported.
      throw new Error(`Unsupported receipt file type: ${kind}`)
    }

    let suggestedEnvelopeId: string | null = null
    let suggestedEnvelopeName: string | null = null
    let confidence = 0

    if (result.payee) {
      const match = await matchEnvelope(session.user.id, result.payee)
      if (match) {
        suggestedEnvelopeId = match.envelopeId
        confidence = match.confidence
        const envelope = await prisma.envelope.findUnique({
          where: { id: match.envelopeId },
          select: { name: true },
        })
        suggestedEnvelopeName = envelope?.name ?? null
      }
    }

    return NextResponse.json({
      ...result,
      suggestedEnvelopeId,
      suggestedEnvelopeName,
      confidence,
    })
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
