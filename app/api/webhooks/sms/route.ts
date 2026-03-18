import { NextRequest, NextResponse } from "next/server"
import { verifyTwilioWebhookSignature } from "@/lib/twilio-webhook-verify"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const params: Record<string, string> = {}
  formData.forEach((v, k) => {
    if (typeof v === "string") params[k] = v
  })

  if (process.env.NODE_ENV === "production") {
    const authToken = process.env.TWILIO_AUTH_TOKEN
    const webhookUrl = process.env.TWILIO_SMS_WEBHOOK_URL?.trim()
    const sig = req.headers.get("X-Twilio-Signature")
    if (
      !authToken ||
      !webhookUrl ||
      !verifyTwilioWebhookSignature(authToken, sig, webhookUrl, params)
    ) {
      return new NextResponse("Forbidden", { status: 403 })
    }
  }

  const body = params.Body
  const from = params.From

  if (!body || !from) {
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      {
        headers: { "Content-Type": "text/xml" },
      },
    )
  }

  try {
    const parsed = await parseSmsTransaction(body)
    if (!parsed) {
      return twimlResponse()
    }

    return twimlResponse()
  } catch (err) {
    console.error("SMS webhook error:", err)
    return twimlResponse()
  }
}

async function parseSmsTransaction(
  smsBody: string,
): Promise<{ payee: string; amount: number; date: string } | null> {
  if (!OPENAI_API_KEY) return null

  try {
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
            role: "system",
            content:
              "Extract transaction details from a bank SMS alert. Respond ONLY with valid JSON.",
          },
          {
            role: "user",
            content: `Extract from this bank SMS alert: "${smsBody}"\n\nReturn JSON: {"payee":"<string>","amount":<number>,"date":"<YYYY-MM-DD>"}`,
          },
        ],
        max_tokens: 100,
        temperature: 0,
      }),
    })

    if (!res.ok) return null
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    }
    const text = data.choices?.[0]?.message?.content?.trim() ?? ""
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    return JSON.parse(jsonMatch[0]) as {
      payee: string
      amount: number
      date: string
    }
  } catch {
    return null
  }
}

function twimlResponse(): NextResponse {
  return new NextResponse(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    { headers: { "Content-Type": "text/xml" } },
  )
}
