const OPENAI_API_KEY = process.env.OPENAI_API_KEY

const EXTRACTION_PROMPT = `You are a receipt parser. Extract the following from this receipt:
1. payee — the merchant/store/company name
2. amount — the total amount paid (number only, no currency symbol)
3. date — the transaction date in YYYY-MM-DD format

Respond ONLY with valid JSON: {"payee":"...","amount":"...","date":"..."}
If you cannot determine a field, use an empty string for that field.`

export interface ParsedReceipt {
  payee: string
  amount: string
  date: string
}

export async function parseReceiptText(text: string): Promise<ParsedReceipt> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured")

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
          content: `${EXTRACTION_PROMPT}\n\nReceipt text:\n${text.slice(0, 4000)}`,
        },
      ],
      max_tokens: 200,
      temperature: 0,
    }),
  })

  if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`)

  const data = await res.json()
  const responseText = data.choices?.[0]?.message?.content?.trim() ?? ""
  const jsonMatch = responseText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error("Could not parse response")
  return JSON.parse(jsonMatch[0])
}
