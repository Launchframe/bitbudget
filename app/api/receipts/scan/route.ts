import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { premiumForbiddenResponse, requirePremium } from "@/lib/subscription"
import { matchEnvelope } from "@/lib/envelope-matcher"
import { parseReceiptText } from "@/lib/receipt-parser"
import { PDFParse } from "pdf-parse"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const EXTRACTION_PROMPT = `You are a receipt parser. Extract the following from this receipt:
1. payee — the merchant/store/company name
2. amount — the total amount paid (number only, no currency symbol)
3. date — the transaction date in YYYY-MM-DD format

Respond ONLY with valid JSON: {"payee":"...","amount":"...","date":"..."}
If you cannot determine a field, use an empty string for that field.`

async function extractFromImage(base64: string, mimeType: string) {
  if (!OPENAI_API_KEY) {
    const error: any = new Error("OPENAI_API_KEY is not set; cannot call OpenAI API");
    error.status = 503;
    throw error;
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
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
  if (!jsonMatch) throw new Error("Could not parse response")
  return JSON.parse(jsonMatch[0])
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
    return NextResponse.json({ error: "Receipt scanning is not configured. Set OPENAI_API_KEY." }, { status: 503 })
  }

  try {
    const formData = await req.formData()
    const file = formData.get("file") as File | null
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    let result: { payee: string; amount: string; date: string }

    if (file.type === "application/pdf") {
      const parser = new PDFParse({ data: buffer })
      const textResult = await parser.getText()
      await parser.destroy()
      if (!textResult.text?.trim()) {
        return NextResponse.json({ error: "Could not extract text from PDF" }, { status: 422 })
      }
      result = await parseReceiptText(textResult.text)
    } else if (file.type.startsWith("image/")) {
      const base64 = buffer.toString("base64")
      result = await extractFromImage(base64, file.type)
    } else {
      return NextResponse.json({ error: "Unsupported file type. Use an image or PDF." }, { status: 400 })
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
    const message = err instanceof Error ? err.message : "Failed to scan receipt"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
