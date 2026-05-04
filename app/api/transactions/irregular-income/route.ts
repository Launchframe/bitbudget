import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { createIrregularIncomeBatch } from "@/lib/envelope-funding"

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

  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date (YYYY-MM-DD)" }, { status: 400 })
  }
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
      ledgerFundingEnabled: true,
      monthlyIncome: true,
      publicKey: true,
    },
  })

  if (!user?.ledgerFundingEnabled) {
    return NextResponse.json(
      { error: "Ledger funding must be enabled in Settings first." },
      { status: 400 },
    )
  }

  if (!Number.isFinite(user.monthlyIncome) || user.monthlyIncome <= 0) {
    return NextResponse.json(
      { error: "Set a positive Monthly Income under allocations/settings before irregular income." },
      { status: 400 },
    )
  }

  const createdCount = await createIrregularIncomeBatch({
    userId: session.user.id,
    publicKey: user.publicKey,
    grossUsd: amountNum,
    dateIso: date,
    displayPayee: payee.trim(),
    notesPlain: notesStr,
  })

  if (createdCount <= 0) {
    return NextResponse.json(
      { error: "Could not record irregular income (missing Savings envelope or encryption keys)." },
      { status: 400 },
    )
  }

  return NextResponse.json({ ok: true, created: createdCount })
}
