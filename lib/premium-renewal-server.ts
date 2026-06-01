import { prisma } from "@/lib/db"
import {
  addUtcDays,
  calendarDaysUntilExpiry,
  formatPremiumExpiryCalendarDate,
  isExpiredNotificationDay,
  premiumRenewalLogKey,
  reminderKindForDaysLeft,
  resolveActivePremiumExpiry,
  resolveRecentlyLapsedPremiumExpiry,
  startOfUtcDay,
  utcDayWindowForCalendarDate,
  type ActivePremiumExpiry,
  type PremiumExpirySource,
  type TimedPremiumExpiryRow,
  PREMIUM_RENEWAL_REMINDER_DAYS,
} from "@/lib/premium-expiry"
import { premiumRenewalCopy } from "@/lib/premium-renewal-copy"
import type {
  PremiumExpiredBannerPayload,
  PremiumRenewalPromptPayload,
} from "@/lib/premium-renewal-prompt-types"
import { resolveEffectiveTier } from "@/lib/subscription"

export type { PremiumExpiredBannerPayload, PremiumRenewalPromptPayload } from "@/lib/premium-renewal-prompt-types"

export type PremiumRenewalReminderChannel = "email" | "nostr" | "in_app_dismissed"

const TIMED_PREMIUM_SELECT = {
  subscriptionTier: true,
  premiumTrialUntil: true,
  premiumGratisUntil: true,
  premiumMembershipUntil: true,
} as const

export function timedPremiumExpiryField(source: PremiumExpirySource): keyof TimedPremiumExpiryRow {
  switch (source) {
    case "trial":
      return "premiumTrialUntil"
    case "gratis":
      return "premiumGratisUntil"
    case "membership":
      return "premiumMembershipUntil"
  }
}

export async function renewalReminderAlreadyLogged(
  userId: string,
  logKey: string,
  channel: PremiumRenewalReminderChannel,
): Promise<boolean> {
  const row = await prisma.premiumRenewalReminderLog.findUnique({
    where: {
      userId_logKey_channel: { userId, logKey, channel },
    },
    select: { id: true },
  })
  return !!row
}

export async function recordRenewalReminderLog(
  userId: string,
  logKey: string,
  channel: PremiumRenewalReminderChannel,
): Promise<void> {
  await prisma.premiumRenewalReminderLog.createMany({
    data: [{ userId, logKey, channel }],
    skipDuplicates: true,
  })
}

export async function findUsersForExpiryReminderWindow(
  source: PremiumExpirySource,
  daysBeforeExpiry: number,
  now: Date = new Date(),
): Promise<Array<{ id: string; expiry: Date }>> {
  const today = startOfUtcDay(now)
  const targetDay = addUtcDays(today, daysBeforeExpiry)
  const window = utcDayWindowForCalendarDate(targetDay)
  const dateFilter = { gte: window.gte, lt: window.lt }

  switch (source) {
    case "trial": {
      const rows = await prisma.user.findMany({
        where: {
          subscriptionTier: { not: "premium" },
          premiumTrialUntil: dateFilter,
        },
        select: { id: true, premiumTrialUntil: true },
      })
      return rows.flatMap((row) =>
        row.premiumTrialUntil ? [{ id: row.id, expiry: row.premiumTrialUntil }] : [],
      )
    }
    case "gratis": {
      const rows = await prisma.user.findMany({
        where: {
          subscriptionTier: { not: "premium" },
          premiumGratisUntil: dateFilter,
        },
        select: { id: true, premiumGratisUntil: true },
      })
      return rows.flatMap((row) =>
        row.premiumGratisUntil ? [{ id: row.id, expiry: row.premiumGratisUntil }] : [],
      )
    }
    case "membership": {
      const rows = await prisma.user.findMany({
        where: {
          subscriptionTier: "premium",
          premiumMembershipUntil: dateFilter,
        },
        select: { id: true, premiumMembershipUntil: true },
      })
      return rows.flatMap((row) =>
        row.premiumMembershipUntil ? [{ id: row.id, expiry: row.premiumMembershipUntil }] : [],
      )
    }
  }
}

export async function findUsersForExpiredNotification(
  source: PremiumExpirySource,
  now: Date = new Date(),
): Promise<Array<{ id: string; expiry: Date }>> {
  const today = startOfUtcDay(now)
  const yesterday = addUtcDays(today, -1)
  const window = utcDayWindowForCalendarDate(yesterday)
  const dateFilter = { gte: window.gte, lt: window.lt }

  switch (source) {
    case "trial": {
      const rows = await prisma.user.findMany({
        where: {
          subscriptionTier: { not: "premium" },
          premiumTrialUntil: dateFilter,
        },
        select: { id: true, premiumTrialUntil: true },
      })
      return rows.flatMap((row) =>
        row.premiumTrialUntil && isExpiredNotificationDay(row.premiumTrialUntil, now)
          ? [{ id: row.id, expiry: row.premiumTrialUntil }]
          : [],
      )
    }
    case "gratis": {
      const rows = await prisma.user.findMany({
        where: {
          subscriptionTier: { not: "premium" },
          premiumGratisUntil: dateFilter,
        },
        select: { id: true, premiumGratisUntil: true },
      })
      return rows.flatMap((row) =>
        row.premiumGratisUntil && isExpiredNotificationDay(row.premiumGratisUntil, now)
          ? [{ id: row.id, expiry: row.premiumGratisUntil }]
          : [],
      )
    }
    case "membership": {
      const rows = await prisma.user.findMany({
        where: {
          subscriptionTier: "premium",
          premiumMembershipUntil: dateFilter,
        },
        select: { id: true, premiumMembershipUntil: true },
      })
      return rows.flatMap((row) =>
        row.premiumMembershipUntil && isExpiredNotificationDay(row.premiumMembershipUntil, now)
          ? [{ id: row.id, expiry: row.premiumMembershipUntil }]
          : [],
      )
    }
  }
}

export async function clearExpiredTimedPremiumField(
  userId: string,
  source: PremiumExpirySource,
): Promise<void> {
  const field = timedPremiumExpiryField(source)
  await prisma.user.update({
    where: { id: userId },
    data: { [field]: null },
  })
}

function buildPromptFromExpiry(
  active: ActivePremiumExpiry,
  now: Date,
): PremiumRenewalPromptPayload | null {
  const daysLeft = calendarDaysUntilExpiry(active.expiryInstant, now)
  const kind = reminderKindForDaysLeft(daysLeft)
  if (!kind) return null

  const expiryDate = formatPremiumExpiryCalendarDate(active.expiryInstant)
  const copy = premiumRenewalCopy(active.population, kind, expiryDate, daysLeft)
  const logKey = premiumRenewalLogKey(active.source, active.expiryInstant, kind)

  return {
    logKey,
    kind,
    population: active.population,
    expiryDate,
    daysRemaining: daysLeft,
    headline: copy.headline,
    body: copy.body,
    referralLine: copy.referralLine,
    pricingLine: copy.pricingLine,
    ctaRenew: copy.ctaRenew,
    ctaRefer: copy.ctaRefer,
    settingsReferralsPath: "#/settings/general",
  }
}

export async function resolvePremiumRenewalPromptForUser(
  userId: string,
  now: Date = new Date(),
): Promise<PremiumRenewalPromptPayload | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: TIMED_PREMIUM_SELECT,
  })
  if (!user) return null

  const active = resolveActivePremiumExpiry(user, now)
  if (!active) return null

  const prompt = buildPromptFromExpiry(active, now)
  if (!prompt) return null

  const dismissed = await renewalReminderAlreadyLogged(userId, prompt.logKey, "in_app_dismissed")
  if (dismissed) return null

  return prompt
}

export async function resolvePremiumExpiredBannerForUser(
  userId: string,
  now: Date = new Date(),
): Promise<PremiumExpiredBannerPayload | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: TIMED_PREMIUM_SELECT,
  })
  if (!user) return null

  const tier = resolveEffectiveTier(user, now)
  if (tier !== "free") return null

  const lapsed = resolveRecentlyLapsedPremiumExpiry(user, now)
  if (!lapsed) return null

  const logKey = premiumRenewalLogKey(lapsed.source, lapsed.expiryInstant, "expired")
  const dismissed = await renewalReminderAlreadyLogged(userId, logKey, "in_app_dismissed")
  if (dismissed) return null

  const expiryDate = formatPremiumExpiryCalendarDate(lapsed.expiryInstant)
  const copy = premiumRenewalCopy(lapsed.population, "expired", expiryDate)

  return {
    logKey,
    population: lapsed.population,
    expiryDate,
    headline: copy.headline,
    body: copy.body,
    pricingLine: copy.pricingLine,
    ctaRenew: copy.ctaRenew,
  }
}

export const PREMIUM_EXPIRY_SOURCES: PremiumExpirySource[] = ["trial", "gratis", "membership"]

export { PREMIUM_RENEWAL_REMINDER_DAYS }
