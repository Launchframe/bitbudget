import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import {
  SAVINGS_GOAL_DEFAULT_PERIOD,
  decimalToNumber,
  graceEndsAtForPeriod,
  resolveSavingsGoalTarget,
  savingsGoalEditability,
} from "@/lib/savings-goal"
import { validateDecimal12_2 } from "@/lib/decimal-validation"

const PERIOD_KEY_RE = /^\d{4}-\d{2}$/

function currentPeriodKeyUtc(now = new Date()): string {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() + 1
  return `${y}-${String(m).padStart(2, "0")}`
}

function parsePeriodKey(value: string | null, now = new Date()): string | null {
  if (value == null || value === "") return currentPeriodKeyUtc(now)
  if (value === SAVINGS_GOAL_DEFAULT_PERIOD || PERIOD_KEY_RE.test(value)) return value
  return null
}

function serializeGoalRow(
  row: {
    periodKey: string
    targetAmount: Prisma.Decimal
    graceEndsAt: Date | null
    closedAt: Date | null
    startBalance: Prisma.Decimal | null
    endBalance: Prisma.Decimal | null
    actualSavedAmount: Prisma.Decimal | null
    netSavingsInflow: Prisma.Decimal | null
    achievedGoal: boolean | null
    progressPct: Prisma.Decimal | null
    createdAt: Date
    updatedAt: Date
  },
  resolvedFrom: "explicit" | "default",
  editability: ReturnType<typeof savingsGoalEditability>,
) {
  return {
    periodKey: row.periodKey,
    targetAmount: Number(row.targetAmount),
    resolvedFrom,
    editability,
    graceEndsAt: row.graceEndsAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    startBalance: decimalToNumber(row.startBalance),
    endBalance: decimalToNumber(row.endBalance),
    actualSavedAmount: decimalToNumber(row.actualSavedAmount),
    netSavingsInflow: decimalToNumber(row.netSavingsInflow),
    achievedGoal: row.achievedGoal,
    progressPct: decimalToNumber(row.progressPct),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const periodKey = parsePeriodKey(req.nextUrl.searchParams.get("periodKey"))
  if (!periodKey) {
    return NextResponse.json({ error: "Invalid periodKey (use YYYY-MM or 'default')" }, { status: 400 })
  }

  const userId = session.user.id
  const now = new Date()

  if (periodKey === SAVINGS_GOAL_DEFAULT_PERIOD) {
    const row = await prisma.savingsGoal.findUnique({
      where: { userId_periodKey: { userId, periodKey } },
    })
    const targetAmount = row ? Number(row.targetAmount) : 0
    return NextResponse.json({
      periodKey,
      targetAmount,
      resolvedFrom: row ? "explicit" : "default",
      editability: "editable" as const,
      graceEndsAt: null,
      closedAt: null,
      startBalance: decimalToNumber(row?.startBalance),
      endBalance: decimalToNumber(row?.endBalance),
      actualSavedAmount: decimalToNumber(row?.actualSavedAmount),
      netSavingsInflow: decimalToNumber(row?.netSavingsInflow),
      achievedGoal: row?.achievedGoal ?? null,
      progressPct: decimalToNumber(row?.progressPct),
      createdAt: row?.createdAt.toISOString() ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    })
  }

  const explicit = await prisma.savingsGoal.findUnique({
    where: { userId_periodKey: { userId, periodKey } },
  })

  if (explicit) {
    return NextResponse.json(
      serializeGoalRow(explicit, "explicit", savingsGoalEditability(explicit, now)),
    )
  }

  const defaultRow = await prisma.savingsGoal.findUnique({
    where: { userId_periodKey: { userId, periodKey: SAVINGS_GOAL_DEFAULT_PERIOD } },
  })
  const targetAmount = await resolveSavingsGoalTarget(userId, periodKey)

  return NextResponse.json({
    periodKey,
    targetAmount,
    resolvedFrom: "default" as const,
    editability: "editable" as const,
    graceEndsAt: null,
    closedAt: null,
    startBalance: null,
    endBalance: null,
    actualSavedAmount: null,
    netSavingsInflow: null,
    achievedGoal: null,
    progressPct: null,
    createdAt: defaultRow?.createdAt.toISOString() ?? null,
    updatedAt: defaultRow?.updatedAt.toISOString() ?? null,
  })
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 })
  }

  const { periodKey, targetAmount } = raw as Record<string, unknown>
  if (typeof periodKey !== "string") {
    return NextResponse.json({ error: "periodKey is required" }, { status: 400 })
  }
  if (periodKey !== SAVINGS_GOAL_DEFAULT_PERIOD && !PERIOD_KEY_RE.test(periodKey)) {
    return NextResponse.json({ error: "periodKey must be YYYY-MM or 'default'" }, { status: 400 })
  }

  const amountNum = typeof targetAmount === "number" ? targetAmount : Number(targetAmount)
  const validatedAmount = validateDecimal12_2(amountNum, "targetAmount")
  if (!validatedAmount.ok) {
    return NextResponse.json({ error: validatedAmount.error }, { status: 400 })
  }
  const roundedAmount = validatedAmount.value

  const userId = session.user.id
  const now = new Date()

  const existing = await prisma.savingsGoal.findUnique({
    where: { userId_periodKey: { userId, periodKey } },
  })

  if (existing) {
    const editability = savingsGoalEditability(existing, now)
    if (editability === "closed") {
      return NextResponse.json({ error: "Savings goal for this period is closed", code: "SAVINGS_GOAL_CLOSED" }, { status: 409 })
    }
    if (editability === "upward_only" && roundedAmount <= Number(existing.targetAmount)) {
      return NextResponse.json(
        { error: "Grace period expired; only upward edits are allowed", code: "SAVINGS_GOAL_GRACE_EXPIRED" },
        { status: 409 },
      )
    }

    const updated = await prisma.savingsGoal.update({
      where: { userId_periodKey: { userId, periodKey } },
      data: { targetAmount: new Prisma.Decimal(roundedAmount) },
    })

    return NextResponse.json(
      serializeGoalRow(updated, "explicit", savingsGoalEditability(updated, now)),
    )
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { createdAt: true },
  })
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const graceEndsAt =
    periodKey === SAVINGS_GOAL_DEFAULT_PERIOD
      ? null
      : graceEndsAtForPeriod({ periodKey, userCreatedAt: user.createdAt })

  const created = await prisma.savingsGoal.create({
    data: {
      userId,
      periodKey,
      targetAmount: new Prisma.Decimal(roundedAmount),
      graceEndsAt,
    },
  })

  return NextResponse.json(
    serializeGoalRow(created, "explicit", savingsGoalEditability(created, now)),
    { status: 201 },
  )
}
