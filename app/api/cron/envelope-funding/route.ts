import { timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { detectAchievementsForUser } from "@/lib/achievements"
import { processEnvelopeFundingForUser } from "@/lib/envelope-funding"
import { sweepDiscretionaryEnvelopesForUser } from "@/lib/envelope-sweep"
import { isFundingDayForUser } from "@/lib/pay-cadence-server"
import { type PaydayUserFields } from "@/lib/payday-cadence"
import { prisma } from "@/lib/db"
import { closePreviousPeriodGoal, openCurrentPeriodGoal } from "@/lib/savings-goal-cron"

function bearerMatches(secret: string, authHeader: string | null): boolean {
  const expected = Buffer.from(`Bearer ${secret}`, "utf8")
  const received = Buffer.from(authHeader ?? "", "utf8")
  if (expected.length !== received.length) return false
  try {
    return timingSafeEqual(expected, received)
  } catch {
    return false
  }
}

export interface EnvelopeFundingCronResult {
  usersProcessed: number
  goalsClosed: number
  goalsOpened: number
  sweepTransactionsCreated: number
  fundTransactionsCreated: number
  achievementsDetected: number
}

/** Daily cron pipeline per user: close goal → open goal → sweep → fund → achievements. */
export async function processEnvelopeFundingCron(asOf?: Date): Promise<EnvelopeFundingCronResult> {
  const now = asOf ?? new Date()
  const users = await prisma.user.findMany({
    where: {
      publicKey: { not: null },
      NOT: { publicKey: "" },
    },
    select: {
      id: true,
      payCadence: true,
      payDays: true,
      payDayOfWeek: true,
      lastPaydayAt: true,
    },
  })

  const result: EnvelopeFundingCronResult = {
    usersProcessed: users.length,
    goalsClosed: 0,
    goalsOpened: 0,
    sweepTransactionsCreated: 0,
    fundTransactionsCreated: 0,
    achievementsDetected: 0,
  }

  for (const u of users) {
    const goalClosed = await closePreviousPeriodGoal(u.id, now)
    if (goalClosed) result.goalsClosed++

    const goalOpened = await openCurrentPeriodGoal(u.id, now)
    if (goalOpened) result.goalsOpened++

    const paydayUser: PaydayUserFields = {
      payCadence: u.payCadence,
      payDays: u.payDays,
      payDayOfWeek: u.payDayOfWeek,
      lastPaydayAt: u.lastPaydayAt,
    }

    let sweepCreated = 0
    let fundCreated = 0
    if (isFundingDayForUser(paydayUser, now)) {
      sweepCreated = await sweepDiscretionaryEnvelopesForUser(u.id, now)
      fundCreated = await processEnvelopeFundingForUser(u.id, now)
      result.sweepTransactionsCreated += sweepCreated
      result.fundTransactionsCreated += fundCreated
    }

    if (goalClosed || goalOpened || sweepCreated > 0 || fundCreated > 0) {
      result.achievementsDetected += await detectAchievementsForUser(u.id, now)
    }
  }

  return result
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret == null || cronSecret === "") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!bearerMatches(cronSecret, req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await processEnvelopeFundingCron()
    return NextResponse.json(result)
  } catch (err) {
    console.error("[cron/envelope-funding] Error:", err)
    return NextResponse.json({ error: "Processing failed" }, { status: 500 })
  }
}
