const OPENAI_API_KEY = process.env.OPENAI_API_KEY

const EXTRACTION_PROMPT = `You extract debit/credit card transaction details from a bank push notification or SMS alert.
Respond ONLY with valid JSON: {"payee":"<merchant or description>","amount":<positive number>,"date":"<YYYY-MM-DD>"}
Use today's date in the user's locale only if no date appears in the alert.
Amount must be a positive number (no currency symbol). If you cannot determine payee and amount, respond with {"payee":"","amount":0,"date":""}.`

export interface ParsedBankAlert {
  payee: string
  amount: number
  date: string
}

export function composeBankAlertText(input: {
  text?: string | null
  title?: string | null
  body?: string | null
}): string | null {
  const direct = input.text?.trim()
  if (direct) return direct
  const title = input.title?.trim() ?? ""
  const body = input.body?.trim() ?? ""
  if (!title && !body) return null
  if (title && body) return `${title}\n${body}`
  return title || body
}

export async function parseBankAlertText(alertText: string): Promise<ParsedBankAlert | null> {
  if (!OPENAI_API_KEY) return null

  const trimmed = alertText.trim().slice(0, 4000)
  if (!trimmed) return null

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
          { role: "system", content: EXTRACTION_PROMPT },
          { role: "user", content: `Bank alert:\n${trimmed}` },
        ],
        max_tokens: 120,
        temperature: 0,
      }),
    })

    const data = (await res.json().catch(() => ({}))) as
      | { choices?: Array<{ message?: { content?: string } }> }
      | { error?: { message?: string } }

    if (!res.ok) {
      const message = "error" in data ? data.error?.message : undefined
      if (res.status === 429) {
        throw new Error(
          `OpenAI rate limit exceeded (429). ${message || "Try again in a minute."}`,
        )
      }
      return null
    }

    const content =
      "choices" in data ? data.choices?.[0]?.message?.content?.trim() ?? "" : ""
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0]) as ParsedBankAlert
    if (!parsed.payee?.trim() || !(parsed.amount > 0)) return null
    return {
      payee: parsed.payee.trim(),
      amount: parsed.amount,
      date: parsed.date?.trim() || new Date().toISOString().slice(0, 10),
    }
  } catch {
    return null
  }
}
