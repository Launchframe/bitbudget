import { prisma } from "@/lib/db"
import {
  sendAdminDigestEmail,
  sendGratisExpiredEmail,
  sendGratisExpiringEmail,
  sendPremiumRenewalReminderEmail,
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
  sendPremiumRenewalReminderDm,
  sendReferralAcceptedDm,
  sendReferralActivatedDm,
  sendTrialExpiredDm,
  sendTrialEndingDm,
} from "@/lib/nostr-dm"
import {
  type CommunicationEmailCategory,
  communicationPreferenceForCategory,
  userAllowsCommunicationEmail,
} from "@/lib/communication-preferences"
import {
  outboundNotificationEmails,
  userAllowsNostrDm,
} from "@/lib/notification-contact"
import {
  formatPremiumExpiryCalendarDate,
  premiumRenewalLogKey,
  sourceToPopulation,
  type PremiumExpirySource,
  type PremiumRenewalReminderKind,
} from "@/lib/premium-expiry"
import {
  premiumRenewalCopy,
  premiumRenewalEmailSubject,
  premiumRenewalNostrBody,
} from "@/lib/premium-renewal-copy"
import {
  recordRenewalReminderLog,
  renewalReminderAlreadyLogged,
} from "@/lib/premium-renewal-server"

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
  user: {
    email: string | null
    notificationEmails?: { email: string; verifiedAt: Date }[]
    nostrPubkey: string | null
    nostrDmEnabled?: boolean | null
  },
  emailFn: (to: string) => Promise<void>,
  dmFn: () => Promise<void>,
): Promise<void> {
  const emails = outboundNotificationEmails(user)
  for (const to of emails) {
    await emailFn(to)
  }
  if (userAllowsNostrDm(user)) {
    await dmFn()
  }
}

type PreferenceAwareUser = {
  email: string | null
  notificationEmails?: { email: string; verifiedAt: Date }[]
  nostrPubkey: string | null
  nostrDmEnabled?: boolean | null
  emailUnsubscribeToken: string
} & Partial<Record<ReturnType<typeof communicationPreferenceForCategory>["field"], boolean | null>>

const COMMUNICATION_EMAIL_SELECT = {
  email: true,
  notificationEmails: { select: { email: true, verifiedAt: true } },
  nostrPubkey: true,
  nostrDmEnabled: true,
  emailFeatureUpdates: true,
  emailFeedbackRequests: true,
  emailRecurringReminders: true,
  emailRenewalReminders: true,
  emailImportAlerts: true,
  emailUnsubscribeToken: true,
} as const

async function dispatchPreferenceEmailToUser(
  user: PreferenceAwareUser,
  category: CommunicationEmailCategory,
  emailFn: (
    to: string,
    options: { category: CommunicationEmailCategory; unsubscribeToken: string | null },
  ) => Promise<void>,
  dmFn: () => Promise<void>,
): Promise<void> {
  const emails = outboundNotificationEmails(user)
  if (emails.length > 0 && userAllowsCommunicationEmail(user, category)) {
    const options = { category, unsubscribeToken: user.emailUnsubscribeToken }
    for (const to of emails) {
      await emailFn(to, options)
    }
  }
  if (userAllowsNostrDm(user)) {
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
    select: COMMUNICATION_EMAIL_SELECT,
  })
  if (!referrer) return
  await dispatchPreferenceEmailToUser(
    referrer,
    "feature_updates",
    (to, options) => sendReferralAcceptedEmail(to, args.refereeName, options),
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
      select: COMMUNICATION_EMAIL_SELECT,
    }),
    prisma.user.findUnique({
      where: { id: args.refereeUserId },
      select: { name: true, email: true, nostrPubkey: true },
    }),
  ])
  if (!referrer) return
  const refereeName = userContactLabel(referee ?? {})
  const dateStr = args.newGratisUntil.toISOString().slice(0, 10)
  await dispatchPreferenceEmailToUser(
    referrer,
    "feature_updates",
    (to, options) =>
      sendReferralActivatedEmail(to, refereeName, args.rewardMonths, dateStr, options),
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
    select: COMMUNICATION_EMAIL_SELECT,
  })
  for (const a of admins) {
    await dispatchToUser(
      a,
      (to) => sendSurveyCompletedAdminEmail(to, payload),
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
    select: COMMUNICATION_EMAIL_SELECT,
  })
  for (const a of admins) {
    await dispatchToUser(
      a,
      (to) => sendAdminDigestEmail(to, bodyHtml),
      () => sendAdminDigestDm(a.nostrPubkey!, plainFallback),
    )
  }
}

/** Cron: users whose gratis premium ends in ~7 days */
export async function notifyGratisNearingExpiry(userId: string, expiry: Date, days: number): Promise<void> {
  if (skipOutboundUserNotifications()) return
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: COMMUNICATION_EMAIL_SELECT,
  })
  if (!u) return
  const d = expiry.toISOString().slice(0, 10)
  await dispatchPreferenceEmailToUser(
    u,
    "renewal_reminders",
    (to, options) => sendGratisExpiringEmail(to, d, days, options),
    () => sendGratisExpiringDm(u.nostrPubkey!, d, days),
  )
}

export async function notifyGratisExpiredUser(userId: string): Promise<void> {
  if (skipOutboundUserNotifications()) return
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: COMMUNICATION_EMAIL_SELECT,
  })
  if (!u) return
  await dispatchPreferenceEmailToUser(
    u,
    "renewal_reminders",
    (to, options) => sendGratisExpiredEmail(to, options),
    () => sendGratisExpiredDm(u.nostrPubkey!),
  )
}

export async function notifyTrialNearingExpiry(userId: string, expiry: Date, days: number): Promise<void> {
  if (skipOutboundUserNotifications()) return
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: COMMUNICATION_EMAIL_SELECT,
  })
  if (!u) return
  const d = expiry.toISOString().slice(0, 10)
  await dispatchPreferenceEmailToUser(
    u,
    "renewal_reminders",
    (to, options) => sendTrialEndingEmail(to, d, days, options),
    () => sendTrialEndingDm(u.nostrPubkey!, d, days),
  )
}

export async function notifyTrialExpiredUser(userId: string): Promise<void> {
  if (skipOutboundUserNotifications()) return
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: COMMUNICATION_EMAIL_SELECT,
  })
  if (!u) return
  await dispatchPreferenceEmailToUser(
    u,
    "renewal_reminders",
    (to, options) => sendTrialExpiredEmail(to, options),
    () => sendTrialExpiredDm(u.nostrPubkey!),
  )
}

function appUrlForNotify(): string | undefined {
  const base = process.env.NEXTAUTH_URL?.replace(/\/$/, "")
  return base || undefined
}

/** Cron: unified premium renewal reminder with per-channel dedup. */
export async function notifyPremiumRenewalReminder(args: {
  userId: string
  source: PremiumExpirySource
  expiry: Date
  kind: PremiumRenewalReminderKind
}): Promise<{ emailSent: boolean; nostrSent: boolean }> {
  if (skipOutboundUserNotifications()) return { emailSent: false, nostrSent: false }

  const u = await prisma.user.findUnique({
    where: { id: args.userId },
    select: COMMUNICATION_EMAIL_SELECT,
  })
  if (!u) return { emailSent: false, nostrSent: false }

  const population = sourceToPopulation(args.source)
  const expiryDate = formatPremiumExpiryCalendarDate(args.expiry)
  const daysRemaining =
    args.kind === "expired" ? undefined : args.kind
  const copy = premiumRenewalCopy(population, args.kind, expiryDate, daysRemaining)
  const subject = premiumRenewalEmailSubject(population, args.kind, daysRemaining)
  const logKey = premiumRenewalLogKey(args.source, args.expiry, args.kind)
  const appUrl = appUrlForNotify()
  const nostrText = premiumRenewalNostrBody(population, args.kind, expiryDate, daysRemaining, appUrl)

  let emailSent = false
  let nostrSent = false

  const emails = outboundNotificationEmails(u)
  if (emails.length > 0 && userAllowsCommunicationEmail(u, "renewal_reminders")) {
    const already = await renewalReminderAlreadyLogged(args.userId, logKey, "email")
    if (!already) {
      const options = { category: "renewal_reminders" as const, unsubscribeToken: u.emailUnsubscribeToken }
      for (const to of emails) {
        await sendPremiumRenewalReminderEmail(
          to,
          {
            subject,
            headline: copy.headline,
            body: copy.body,
            ctaRenew: copy.ctaRenew,
            ctaRefer: copy.ctaRefer,
            showReferCta: args.kind !== "expired",
          },
          options,
        )
      }
      await recordRenewalReminderLog(args.userId, logKey, "email")
      emailSent = true
    }
  }

  if (userAllowsNostrDm(u) && u.nostrPubkey) {
    const already = await renewalReminderAlreadyLogged(args.userId, logKey, "nostr")
    if (!already) {
      await sendPremiumRenewalReminderDm(u.nostrPubkey, nostrText)
      await recordRenewalReminderLog(args.userId, logKey, "nostr")
      nostrSent = true
    }
  }

  return { emailSent, nostrSent }
}
