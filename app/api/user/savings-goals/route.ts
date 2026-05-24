import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { decimalToNumber, savingsGoalEditability } from "@/lib/savings-goal"

const PERIOD_KEY_RE = /^\d{4}-\d{2}$/

function parsePeriodRange(from: string | null, to: string | null): { from: string; to: string } | null {
  if (!from || !to) return null
  if (!PERIOD_KEY_RE.test(from) || !PERIOD_KEY_RE.test(to)) return null
  if (from > to) return null
  return { from, to }
}

function currentPeriodKeyUtc(now = new Date()): string {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() + 1
  return `${y}-${String(m).padStart(2, "0")}`
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const range = parsePeriodRange(
    req.nextUrl.searchParams.get("from"),
    req.nextUrl.searchParams.get("to"),
  )
  if (!range) {
    return NextResponse.json(
      { error: "from and to query params are required (YYYY-MM)" },
      { status: 400 },
    )
  }

  const userId = session.user.id
  const now = new Date()
  const currentPeriod = currentPeriodKeyUtc(now)

  const rows = await prisma.savingsGoal.findMany({
    where: {
      userId,
      periodKey: { gte: range.from, lte: range.to },
    },
    orderBy: { periodKey: "asc" },
  })

  const closed = rows.filter(r => r.closedAt != null)
  const openInRange = rows.filter(r => r.closedAt == null)

  let currentOpen = openInRange.find(r => r.periodKey === currentPeriod) ?? null
  if (!currentOpen && currentPeriod >= range.from && currentPeriod <= range.to) {
    currentOpen = await prisma.savingsGoal.findUnique({
      where: { userId_periodKey: { userId, periodKey: currentPeriod } },
    })
  }

  const goals = [
    ...closed.map(row => ({
      periodKey: row.periodKey,
      targetAmount: Number(row.targetAmount),
      editability: savingsGoalEditability(row, now),
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
    })),
    ...(currentOpen && currentOpen.closedAt == null
      ? [
          {
            periodKey: currentOpen.periodKey,
            targetAmount: Number(currentOpen.targetAmount),
            editability: savingsGoalEditability(currentOpen, now),
            graceEndsAt: currentOpen.graceEndsAt?.toISOString() ?? null,
            closedAt: null,
            startBalance: decimalToNumber(currentOpen.startBalance),
            endBalance: decimalToNumber(currentOpen.endBalance),
            actualSavedAmount: decimalToNumber(currentOpen.actualSavedAmount),
            netSavingsInflow: decimalToNumber(currentOpen.netSavingsInflow),
            achievedGoal: currentOpen.achievedGoal,
            progressPct: decimalToNumber(currentOpen.progressPct),
            createdAt: currentOpen.createdAt.toISOString(),
            updatedAt: currentOpen.updatedAt.toISOString(),
          },
        ]
      : []),
  ]

  return NextResponse.json({ goals })
}
