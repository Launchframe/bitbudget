import { prisma } from "@/lib/db"
import {
  sendAdminDigestEmail,
  sendGratisExpiredEmail,
  sendGratisExpiringEmail,
  sendReferralAcceptedEmail,
  sendReferralActivatedEmail,
  sendSurveyCompletedAdminEmail,
  sendTrialExpiredEmail,
  sendTrialEndingEmail,
  type SurveyCompletedEmailPayload,
} from "@/lib/email"
import {
  sendAdminDigestDm,
  sendGratisExpiredDm,
  sendGratisExpiringDm,
  sendReferralAcceptedDm,
  sendReferralActivatedDm,
  sendTrialExpiredDm,
  sendTrialEndingDm,
} from "@/lib/nostr-dm"

/** Playwright / CI: avoid real email/DM sends (e.g. seeded `*@bitbudget.test` referrers bounce). */
function skipOutboundUserNotifications(): boolean {
  return process.env.E2E_TEST === "true"
}

export function userContactLabel(u: {
  name?: string | null
  email?: string | null
  nostrPubkey?: string | null
}): string {
  const n = u.name?.trim()
  if (n) return n
  const e = u.email?.trim()
  if (e) return e
  const pk = u.nostrPubkey?.trim()
  if (pk) return `${pk.slice(0, 12)}…`
  return "User"
}

async function dispatchToUser(
  user: { email: string | null; nostrPubkey: string | null },
  emailFn: () => Promise<void>,
  dmFn: () => Promise<void>,
): Promise<void> {
  if (user.email?.trim()) {
    await emailFn()
    return
  }
  if (user.nostrPubkey?.trim()) {
    await dmFn()
  }
}

export async function notifyReferralAccepted(args: {
  referrerId: string
  refereeName: string
}): Promise<void> {
  if (skipOutboundUserNotifications()) return
  const referrer = await prisma.user.findUnique({
    where: { id: args.referrerId },
    select: { email: true, nostrPubkey: true },
  })
  if (!referrer) return
  await dispatchToUser(
    referrer,
    () => sendReferralAcceptedEmail(referrer.email!, args.refereeName),
    () => sendReferralAcceptedDm(referrer.nostrPubkey!, args.refereeName),
  )
}

export async function notifyReferralActivated(args: {
  referrerId: string
  refereeUserId: string
  rewardMonths: number
  newGratisUntil: Date
}): Promise<void> {
  if (skipOutboundUserNotifications()) return
  const [referrer, referee] = await Promise.all([
    prisma.user.findUnique({
      where: { id: args.referrerId },
      select: { email: true, nostrPubkey: true },
    }),
    prisma.user.findUnique({
      where: { id: args.refereeUserId },
      select: { name: true, email: true, nostrPubkey: true },
    }),
  ])
  if (!referrer) return
  const refereeName = userContactLabel(referee ?? {})
  const dateStr = args.newGratisUntil.toISOString().slice(0, 10)
  await dispatchToUser(
    referrer,
    () =>
      sendReferralActivatedEmail(
        referrer.email!,
        refereeName,
        args.rewardMonths,
        dateStr,
      ),
    () =>
      sendReferralActivatedDm(
        referrer.nostrPubkey!,
        refereeName,
        args.rewardMonths,
        dateStr,
      ),
  )
}

export async function notifyAdminsSurveyCompleted(payload: SurveyCompletedEmailPayload): Promise<void> {
  if (skipOutboundUserNotifications()) return
  const admins = await prisma.user.findMany({
    where: { role: "admin" },
    select: { email: true, nostrPubkey: true },
  })
  for (const a of admins) {
    await dispatchToUser(
      a,
      () => sendSurveyCompletedAdminEmail(a.email!, payload),
      async () => {
        const lines = [
          `Survey: ${payload.userLabel}`,
          `Trigger: ${payload.triggerType}`,
          `Rating: ${payload.rating ?? "—"}`,
          `Favorite: ${payload.favoriteFeature ?? "—"}`,
          `Least: ${payload.leastFavorite ?? "—"}`,
          `Comments: ${payload.comments ?? "—"}`,
          `Contact OK: ${payload.canContact === null ? "—" : payload.canContact ? "yes" : "no"}`,
        ]
        await sendAdminDigestDm(a.nostrPubkey!, lines.join("\n"))
      },
    )
  }
}

export async function notifyAdminsDigest(bodyHtml: string, plainFallback: string): Promise<void> {
  if (skipOutboundUserNotifications()) return
  const admins = await prisma.user.findMany({
    where: { role: "admin" },
    select: { email: true, nostrPubkey: true },
  })
  for (const a of admins) {
    await dispatchToUser(
      a,
      () => sendAdminDigestEmail(a.email!, bodyHtml),
      () => sendAdminDigestDm(a.nostrPubkey!, plainFallback),
    )
  }
}

/** Cron: users whose gratis premium ends in ~7 days */
export async function notifyGratisNearingExpiry(userId: string, expiry: Date, days: number): Promise<void> {
  if (skipOutboundUserNotifications()) return
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, nostrPubkey: true },
  })
  if (!u) return
  const d = expiry.toISOString().slice(0, 10)
  await dispatchToUser(
    u,
    () => sendGratisExpiringEmail(u.email!, d, days),
    () => sendGratisExpiringDm(u.nostrPubkey!, d, days),
  )
}

export async function notifyGratisExpiredUser(userId: string): Promise<void> {
  if (skipOutboundUserNotifications()) return
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, nostrPubkey: true },
  })
  if (!u) return
  await dispatchToUser(
    u,
    () => sendGratisExpiredEmail(u.email!),
    () => sendGratisExpiredDm(u.nostrPubkey!),
  )
}

export async function notifyTrialNearingExpiry(userId: string, expiry: Date, days: number): Promise<void> {
  if (skipOutboundUserNotifications()) return
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, nostrPubkey: true },
  })
  if (!u) return
  const d = expiry.toISOString().slice(0, 10)
  await dispatchToUser(
    u,
    () => sendTrialEndingEmail(u.email!, d, days),
    () => sendTrialEndingDm(u.nostrPubkey!, d, days),
  )
}

export async function notifyTrialExpiredUser(userId: string): Promise<void> {
  if (skipOutboundUserNotifications()) return
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, nostrPubkey: true },
  })
  if (!u) return
  await dispatchToUser(
    u,
    () => sendTrialExpiredEmail(u.email!),
    () => sendTrialExpiredDm(u.nostrPubkey!),
  )
}
