import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { decimalToNumber, isValidCalendarMonthPeriodKey, savingsGoalEditability } from "@/lib/savings-goal"

function parsePeriodRange(from: string | null, to: string | null): { from: string; to: string } | null {
  if (!from || !to) return null
  if (!isValidCalendarMonthPeriodKey(from) || !isValidCalendarMonthPeriodKey(to)) return null
  if (from > to) return null
  return { from, to }
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

  const rows = await prisma.savingsGoal.findMany({
    where: {
      userId,
      periodKey: { gte: range.from, lte: range.to },
    },
    orderBy: { periodKey: "asc" },
  })

  const goals = rows.map(row => ({
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
  }))

  return NextResponse.json({ goals })
}
