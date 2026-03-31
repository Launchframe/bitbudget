import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { notifyAdminsDigest } from "@/lib/notify"

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  const [
    newUserCodes,
    accepted,
    activated,
    newOffers,
    surveyDone,
    expiringTrials,
    expiringGratis,
    usersWithGratis,
  ] = await Promise.all([
    prisma.referralCode.count({
      where: { type: "user", createdAt: { gte: since } },
    }),
    prisma.referral.findMany({
      where: { acceptedAt: { gte: since } },
      include: { code: { select: { code: true, type: true, label: true } } },
    }),
    prisma.referral.findMany({
      where: { activatedAt: { gte: since } },
      include: { referrer: { select: { name: true, email: true } } },
    }),
    prisma.referralCode.findMany({
      where: { type: "offer", createdAt: { gte: since } },
      select: { code: true, label: true, visitCount: true, usedCount: true },
    }),
    prisma.survey.count({ where: { completedAt: { gte: since } } }),
    prisma.user.count({
      where: {
        premiumTrialUntil: { gt: now, lte: new Date(now.getTime() + 7 * 86400000) },
      },
    }),
    prisma.user.count({
      where: {
        subscriptionTier: { not: "premium" },
        premiumGratisUntil: { gt: now, lte: new Date(now.getTime() + 7 * 86400000) },
      },
    }),
    prisma.user.findMany({
      where: { premiumGratisUntil: { gt: now }, subscriptionTier: { not: "premium" } },
      select: { premiumGratisUntil: true },
    }),
  ])

  let liabilityMonths = 0
  for (const u of usersWithGratis) {
    if (!u.premiumGratisUntil) continue
    const ms = u.premiumGratisUntil.getTime() - now.getTime()
    liabilityMonths += Math.max(0, ms / (30.44 * 86400000))
  }

  const lines = [
    `<p><strong>Last 24h</strong></p>`,
    `<ul>`,
    `<li>New user referral codes: ${newUserCodes}</li>`,
    `<li>Referrals accepted: ${accepted.length}</li>`,
    `<li>Referrals activated: ${activated.length}</li>`,
    `<li>Survey completions: ${surveyDone}</li>`,
    `</ul>`,
    `<p><strong>Accepted codes</strong>: ${accepted.map((a) => a.code.code).join(", ") || "—"}</p>`,
    `<p><strong>Activations</strong>: ${activated.map((a) => a.referrer.name ?? a.referrer.email ?? "?").join(", ") || "—"}</p>`,
    `<p>Expiring trials (7d): ${expiringTrials} | Expiring gratis (7d): ${expiringGratis}</p>`,
    `<p>Approx. outstanding gratis months (liability): ${liabilityMonths.toFixed(1)}</p>`,
  ]
  if (newOffers.length) {
    lines.push(`<p>New offers: ${newOffers.map((o) => o.code).join(", ")}</p>`)
  }

  const offerRedemptions = accepted.filter((a) => a.code.type === "offer")
  if (offerRedemptions.length) {
    const bySlug = new Map<string, number>()
    for (const a of offerRedemptions) {
      const k = a.code.code
      bySlug.set(k, (bySlug.get(k) ?? 0) + 1)
    }
    const parts = [...bySlug.entries()].map(([code, n]) => `${code} (${n})`)
    lines.push(`<p><strong>Offer signups (24h)</strong>: ${parts.join(", ")}</p>`)
  }

  const html = lines.join("\n")
  const plain = lines.map((l) => l.replace(/<[^>]+>/g, "")).join("\n")

  await notifyAdminsDigest(html, plain)

  return NextResponse.json({
    ok: true,
    newUserCodes,
    accepted: accepted.length,
    activated: activated.length,
    surveyDone,
  })
}
