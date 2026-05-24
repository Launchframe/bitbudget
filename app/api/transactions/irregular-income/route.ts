import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { createIrregularIncomeBatch } from "@/lib/envelope-funding"
import { parseTransactionQueryCalendarDate } from "@/lib/transaction-query-dates"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected JSON object" }, { status: 400 })
  }
  const { amount, date, payee, notes } = body as Record<string, unknown>

  if (typeof date !== "string") {
    return NextResponse.json({ error: "Invalid date (YYYY-MM-DD)" }, { status: 400 })
  }
  const parsedCalendar = parseTransactionQueryCalendarDate(date)
  if (!parsedCalendar) {
    return NextResponse.json({ error: "Invalid calendar date (YYYY-MM-DD)" }, { status: 400 })
  }
  const dateIso = parsedCalendar.toISOString().slice(0, 10)
  if (typeof payee !== "string" || payee.trim().length === 0) {
    return NextResponse.json({ error: "Payee required" }, { status: 400 })
  }

  const amountNum = typeof amount === "number" ? amount : Number(amount)
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 })
  }

  const notesStr =
    notes === undefined || notes === null
      ? null
      : typeof notes === "string"
        ? notes
        : null
  if (notes !== undefined && notes !== null && typeof notes !== "string") {
    return NextResponse.json({ error: "Invalid notes" }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      monthlyIncome: true,
      publicKey: true,
    },
  })

  if (!Number.isFinite(user?.monthlyIncome) || (user?.monthlyIncome ?? 0) <= 0) {
    return NextResponse.json(
      { error: "Set a positive Monthly Income under allocations/settings before irregular income." },
      { status: 400 },
    )
  }

  const createdCount = await createIrregularIncomeBatch({
    userId: session.user.id,
    publicKey: user!.publicKey,
    grossUsd: amountNum,
    dateIso,
    displayPayee: payee.trim(),
    notesPlain: notesStr,
    userIncome: {
      monthlyIncome: user!.monthlyIncome,
    },
  })

  if (createdCount <= 0) {
    return NextResponse.json(
      {
        error:
          "Could not record extra income. Check Monthly Income and envelope allocations under Allocations, and confirm your encryption keys are set up.",
      },
      { status: 400 },
    )
  }

  return NextResponse.json({ ok: true, created: createdCount })
}
