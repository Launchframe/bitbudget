import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { premiumForbiddenResponse, requirePremiumOrTrial } from "@/lib/subscription"
import { todayTransactionCalendarDay } from "@/lib/transaction-dates"
import { resolveVoiceTransactionDate } from "@/lib/voice-relative-dates"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!(await requirePremiumOrTrial(session.user.id))) {
    return premiumForbiddenResponse("Voice entry requires premium or an active premium trial")
  }

  if (!OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "Voice parsing is not configured. Set OPENAI_API_KEY." },
      { status: 503 },
    )
  }

  const body = await req.json()
  const transcript = body?.transcript
  if (!transcript || typeof transcript !== "string") {
    return NextResponse.json({ error: "transcript is required" }, { status: 400 })
  }

  const clientToday =
    typeof body?.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today)
      ? body.today
      : todayTransactionCalendarDay()

  const envelopes = await prisma.envelope.findMany({
    where: { userId: session.user.id, archived: false },
    select: { id: true, name: true },
  })

  const recentPayees = await prisma.transaction.findMany({
    where: { userId: session.user.id },
    select: { payee: true },
    distinct: ["payee"],
    orderBy: { createdAt: "desc" },
    take: 50,
  })

  const envelopeNames = envelopes.map((e) => e.name)
  const payeeNames = recentPayees.map((t) => t.payee)

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
              "Extract transaction details from natural language. Respond ONLY with valid JSON.",
          },
          {
            role: "user",
            content: `Extract transaction details from: "${transcript}"

Today's date (local calendar): ${clientToday}
Available envelopes: ${envelopeNames.join(", ") || "(none)"}
Recent payees: ${payeeNames.join(", ") || "(none)"}

Return JSON: {"payee":"<string>","amount":<number>,"envelope":"<exact envelope name or null>","date":"<YYYY-MM-DD or null>"}

Rules:
- Match payee names fuzzily to Recent payees when possible (preserve the list's casing/spelling).
- Match envelope names fuzzily to Available envelopes when possible.
- If the user says "today", "yesterday", "tomorrow", or "N days ago", set date to the resolved YYYY-MM-DD relative to Today's date above.
- If no date is mentioned, use null.
- If no envelope matches, use null.
- Amount should be a number (no currency symbols).`,
          },
        ],
        max_tokens: 200,
        temperature: 0,
      }),
    })

    if (!res.ok) {
      return NextResponse.json({ error: "Failed to parse voice input" }, { status: 502 })
    }

    const data = await res.json()
    const text = data.choices?.[0]?.message?.content?.trim() ?? ""
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: "Could not parse response" }, { status: 422 })
    }

    const parsed = JSON.parse(jsonMatch[0])

    let envelopeId: string | null = null
    if (parsed.envelope) {
      const matched = envelopes.find(
        (e) => e.name.toLowerCase() === parsed.envelope.toLowerCase(),
      )
      if (matched) envelopeId = matched.id
    }

    const date = resolveVoiceTransactionDate({
      transcript,
      clientToday,
      modelDate: typeof parsed.date === "string" ? parsed.date : null,
    })

    // Prefer exact casing from Recent payees when soft-equal (case-insensitive).
    let payee = typeof parsed.payee === "string" ? parsed.payee.trim() : ""
    if (payee) {
      const exact = payeeNames.find((p) => p.toLowerCase() === payee.toLowerCase())
      if (exact) payee = exact
    }

    return NextResponse.json({
      payee,
      amount: typeof parsed.amount === "number" ? parsed.amount : 0,
      envelopeId,
      envelopeName: parsed.envelope || null,
      date,
    })
  } catch (err) {
    console.error("voice parse error:", err)
    return NextResponse.json({ error: "Failed to parse voice input" }, { status: 500 })
  }
}
