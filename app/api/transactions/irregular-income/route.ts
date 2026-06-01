import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import {
  createIrregularIncomeBatch,
  type IrregularDistributionMode,
} from "@/lib/envelope-funding"
import type { DistributionBehavior } from "@/lib/rebalance-math"
import { parseTransactionQueryCalendarDate } from "@/lib/transaction-query-dates"

const DISTRIBUTION_BEHAVIORS: DistributionBehavior[] = [
  "set_to_budget",
  "add_budget",
  "custom",
]

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
  const {
    amount,
    date,
    payee,
    notes,
    distributionMode,
    distributionBehavior,
    fundOverageFromSavings,
    envelopeAllocations,
  } = body as Record<string, unknown>

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

  let mode: IrregularDistributionMode = "savings"
  if (distributionMode !== undefined && distributionMode !== null) {
    if (
      distributionMode !== "savings" &&
      distributionMode !== "envelopes" &&
      distributionMode !== "legacy_auto"
    ) {
      return NextResponse.json({ error: "Invalid distributionMode" }, { status: 400 })
    }
    mode = distributionMode
  }

  let behavior: DistributionBehavior | undefined
  if (distributionBehavior !== undefined && distributionBehavior !== null) {
    if (
      typeof distributionBehavior !== "string" ||
      !DISTRIBUTION_BEHAVIORS.includes(distributionBehavior as DistributionBehavior)
    ) {
      return NextResponse.json({ error: "Invalid distributionBehavior" }, { status: 400 })
    }
    behavior = distributionBehavior as DistributionBehavior
  }

  const fundOverage =
    fundOverageFromSavings === true || fundOverageFromSavings === "true"

  let allocations: { envelopeId: string; amountUsd: number }[] | undefined
  if (envelopeAllocations !== undefined && envelopeAllocations !== null) {
    if (!Array.isArray(envelopeAllocations)) {
      return NextResponse.json({ error: "Invalid envelopeAllocations" }, { status: 400 })
    }
    allocations = []
    for (const row of envelopeAllocations) {
      if (typeof row !== "object" || row === null || Array.isArray(row)) {
        return NextResponse.json({ error: "Invalid envelopeAllocations" }, { status: 400 })
      }
      const { envelopeId, amountUsd } = row as Record<string, unknown>
      if (typeof envelopeId !== "string" || envelopeId.trim().length === 0) {
        return NextResponse.json({ error: "Invalid envelopeAllocations" }, { status: 400 })
      }
      const amt = typeof amountUsd === "number" ? amountUsd : Number(amountUsd)
      if (!Number.isFinite(amt) || amt <= 0) {
        return NextResponse.json({ error: "Invalid envelopeAllocations" }, { status: 400 })
      }
      allocations.push({ envelopeId: envelopeId.trim(), amountUsd: amt })
    }
  }

  if (mode === "envelopes" && !allocations?.length && !behavior) {
    return NextResponse.json(
      { error: "Choose how to fill envelopes or put the money in Savings." },
      { status: 400 },
    )
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      monthlyIncome: true,
      publicKey: true,
    },
  })

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!user.publicKey?.trim()) {
    return NextResponse.json(
      { error: "Finish Secure Your Data setup before recording new income." },
      { status: 400 },
    )
  }

  if (!Number.isFinite(user.monthlyIncome) || user.monthlyIncome <= 0) {
    return NextResponse.json(
      { error: "Set a positive Monthly Income under allocations/settings before adding new income." },
      { status: 400 },
    )
  }

  const batchConfig: Record<string, unknown> = {
    distributionMode: mode,
    distributionBehavior: behavior ?? null,
    fundOverageFromSavings: fundOverage,
    grossUsd: amountNum,
    envelopeAllocations: allocations ?? null,
  }

  const createdCount = await createIrregularIncomeBatch({
    userId: session.user.id,
    publicKey: user.publicKey,
    grossUsd: amountNum,
    dateIso,
    displayPayee: payee.trim(),
    notesPlain: notesStr,
    userIncome: {
      monthlyIncome: user.monthlyIncome,
    },
    distributionMode: mode,
    distributionBehavior: behavior,
    fundOverageFromSavings: fundOverage,
    envelopeAllocations: allocations,
    batchConfig,
  })

  if (createdCount <= 0) {
    return NextResponse.json(
      {
        error:
          "Could not record new income. Check your monthly income and envelope amounts, or put the money in Savings only.",
      },
      { status: 400 },
    )
  }

  return NextResponse.json({ ok: true, created: createdCount })
}
