import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getEnvelopeBalance } from "@/lib/data"
import type { Transaction, TransactionType } from "@/lib/data"
import { processRecurringTransactions } from "@/lib/recurring"

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) && parsed.every((tag) => typeof tag === "string") ? parsed : []
  } catch {
    return []
  }
}

function transactionType(raw: string): TransactionType {
  return raw === "credit" ? "credit" : "expense"
}

export async function GET(req: NextRequest) {
  if (process.env.E2E_TEST !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const email = req.nextUrl.searchParams.get("email")
  const asOfParam = req.nextUrl.searchParams.get("asOf")
  if (!email?.endsWith("@bitbudget.test")) {
    return NextResponse.json({ error: "email is required" }, { status: 400 })
  }
  const asOf = asOfParam ? new Date(`${asOfParam}T12:00:00.000Z`) : new Date()
  if (Number.isNaN(asOf.getTime())) {
    return NextResponse.json({ error: "invalid asOf" }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      email: true,
      monthlyIncome: true,
      payCadence: true,
      envelopes: {
        orderBy: { name: "asc" },
        select: { id: true, name: true, monthlyAllotment: true, color: true },
      },
      transactions: {
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          envelopeId: true,
          payee: true,
          amount: true,
          type: true,
          date: true,
          tags: true,
          notes: true,
          recurringId: true,
        },
      },
      recurringTransactions: {
        orderBy: { nextDueDate: "asc" },
        select: {
          id: true,
          envelopeId: true,
          payee: true,
          amount: true,
          type: true,
          cadence: true,
          nextDueDate: true,
          endDate: true,
          active: true,
          tags: true,
        },
      },
      shortcuts: {
        orderBy: [{ usageCount: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          payee: true,
          defaultAmount: true,
          envelopeId: true,
          label: true,
          usageCount: true,
        },
      },
      tags: {
        orderBy: { name: "asc" },
        select: { name: true },
      },
    },
  })

  if (!user) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  const transactions: Transaction[] = user.transactions.map((transaction) => ({
    ...transaction,
    type: transactionType(transaction.type),
    date: transaction.date.toISOString().split("T")[0],
    tags: parseTags(transaction.tags),
  }))
  const envelopeNameById = new Map(user.envelopes.map((envelope) => [envelope.id, envelope.name]))
  const monthKey = asOf.toISOString().slice(0, 7)

  return NextResponse.json({
    dbHost: pgHostFromDatabaseUrl(process.env.DATABASE_URL),
    user: {
      email: user.email,
      monthlyIncome: user.monthlyIncome,
      payCadence: user.payCadence,
    },
    envelopes: user.envelopes.map((envelope) => ({
      id: envelope.id,
      name: envelope.name,
      monthlyAllotment: envelope.monthlyAllotment,
      balance: getEnvelopeBalance(transactions, envelope.id, monthKey, envelope.monthlyAllotment, {
        payCadence: user.payCadence === "bimonthly" ? "bimonthly" : "monthly",
        asOf,
      }),
    })),
    transactions: transactions.map((transaction) => ({
      payee: transaction.payee,
      amount: transaction.amount,
      type: transaction.type,
      date: transaction.date,
      tags: transaction.tags,
      notes: transaction.notes,
      envelopeName: envelopeNameById.get(transaction.envelopeId) ?? "",
      recurringId: transaction.recurringId,
    })),
    recurring: user.recurringTransactions.map((recurring) => ({
      payee: recurring.payee,
      amount: recurring.amount,
      type: recurring.type,
      cadence: recurring.cadence,
      nextDueDate: recurring.nextDueDate.toISOString().split("T")[0],
      endDate: recurring.endDate?.toISOString().split("T")[0] ?? null,
      active: recurring.active,
      tags: parseTags(recurring.tags),
    })),
    shortcuts: user.shortcuts.map((shortcut) => ({
      payee: shortcut.payee,
      defaultAmount: shortcut.defaultAmount,
      label: shortcut.label,
      usageCount: shortcut.usageCount,
    })),
    tags: user.tags,
  })
}

export async function POST(req: NextRequest) {
  if (process.env.E2E_TEST !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const body = (await req.json()) as { email?: unknown; asOf?: unknown }
  if (typeof body.email !== "string" || !body.email.endsWith("@bitbudget.test")) {
    return NextResponse.json({ error: "email is required" }, { status: 400 })
  }
  if (typeof body.asOf !== "string") {
    return NextResponse.json({ error: "asOf is required" }, { status: 400 })
  }
  const asOf = new Date(`${body.asOf}T12:00:00.000Z`)
  if (Number.isNaN(asOf.getTime())) {
    return NextResponse.json({ error: "invalid asOf" }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { email: body.email },
    select: { id: true },
  })
  if (!user) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  const processed = await processRecurringTransactions(user.id, asOf)
  return NextResponse.json({ processed })
}

function pgHostFromDatabaseUrl(url: string | undefined): string | null {
  if (!url) return null
  const match = url.match(/@([^/?]+)(?:\/|\?|$)/)
  return match?.[1] ?? null
}
