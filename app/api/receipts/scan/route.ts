import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { PDFParse } from "pdf-parse"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const EXTRACTION_PROMPT = `You are a receipt parser. Extract the following from this receipt:
1. payee — the merchant/store/company name
2. amount — the total amount paid (number only, no currency symbol)
3. date — the transaction date in YYYY-MM-DD format

Respond ONLY with valid JSON: {"payee":"...","amount":"...","date":"..."}
If you cannot determine a field, use an empty string for that field.`

async function callOpenAI(messages: { role: string; content: unknown }[]): Promise<{ payee: string; amount: string; date: string }> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
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

async function extractFromImage(base64: string, mimeType: string) {
  return callOpenAI([
    {
      role: "user",
      content: [
        { type: "text", text: EXTRACTION_PROMPT },
        { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
      ],
    },
  ])
}

async function extractFromPdfText(text: string) {
  return callOpenAI([
    {
      role: "user",
      content: `${EXTRACTION_PROMPT}\n\nReceipt text:\n${text.slice(0, 4000)}`,
    },
  ])
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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
      result = await extractFromPdfText(textResult.text)
    } else if (file.type.startsWith("image/")) {
      const base64 = buffer.toString("base64")
      result = await extractFromImage(base64, file.type)
    } else {
      return NextResponse.json({ error: "Unsupported file type. Use an image or PDF." }, { status: 400 })
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error("receipt scan error:", err)
    const message = err instanceof Error ? err.message : "Failed to scan receipt"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
