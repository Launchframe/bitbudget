import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import {
  notifyGratisExpiredUser,
  notifyGratisNearingExpiry,
  notifyTrialExpiredUser,
  notifyTrialNearingExpiry,
} from "@/lib/notify"

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function addUtcDays(d: Date, days: number): Date {
  const x = new Date(d.getTime())
  x.setUTCDate(x.getUTCDate() + days)
  return x
}

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()
  const todayStart = startOfUtcDay(now)
  const in7 = addUtcDays(todayStart, 7)
  const in8 = addUtcDays(todayStart, 8)
  const yStart = addUtcDays(todayStart, -1)
  const yEnd = todayStart

  const [gratisWarn, gratisExpired, trialWarn, trialExpired] = await Promise.all([
    prisma.user.findMany({
      where: {
        subscriptionTier: { not: "premium" },
        premiumGratisUntil: { gte: in7, lt: in8 },
      },
      select: { id: true, premiumGratisUntil: true },
    }),
    prisma.user.findMany({
      where: {
        subscriptionTier: { not: "premium" },
        premiumGratisUntil: { gte: yStart, lt: yEnd },
      },
      select: { id: true },
    }),
    prisma.user.findMany({
      where: {
        premiumTrialUntil: { gte: in7, lt: in8 },
      },
      select: { id: true, premiumTrialUntil: true },
    }),
    prisma.user.findMany({
      where: {
        premiumTrialUntil: { gte: yStart, lt: yEnd },
      },
      select: { id: true },
    }),
  ])

  for (const u of gratisWarn) {
    if (u.premiumGratisUntil) {
      await notifyGratisNearingExpiry(u.id, u.premiumGratisUntil, 7)
    }
  }
  for (const u of gratisExpired) {
    await notifyGratisExpiredUser(u.id)
  }
  for (const u of trialWarn) {
    if (u.premiumTrialUntil) {
      await notifyTrialNearingExpiry(u.id, u.premiumTrialUntil, 7)
    }
  }
  for (const u of trialExpired) {
    await notifyTrialExpiredUser(u.id)
    await prisma.user.update({
      where: { id: u.id },
      data: { premiumTrialUntil: null },
    })
  }

  return NextResponse.json({
    ok: true,
    gratisNearing: gratisWarn.length,
    gratisExpiredNotified: gratisExpired.length,
    trialNearing: trialWarn.length,
    trialExpiredCleared: trialExpired.length,
  })
}
