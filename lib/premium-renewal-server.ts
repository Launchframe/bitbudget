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
  type PremiumRenewalReminderKind,
  type TimedPremiumExpiryRow,
  PREMIUM_RENEWAL_REMINDER_DAYS,
} from "@/lib/premium-expiry"
import { premiumRenewalCopy } from "@/lib/premium-renewal-copy"
import { resolveEffectiveTier } from "@/lib/subscription"

export type PremiumRenewalReminderChannel = "email" | "nostr" | "in_app_dismissed"

const TIMED_PREMIUM_SELECT = {
  subscriptionTier: true,
  premiumTrialUntil: true,
  premiumGratisUntil: true,
  premiumMembershipUntil: true,
} as const

export interface PremiumRenewalPromptPayload {
  logKey: string
  kind: Exclude<PremiumRenewalReminderKind, "expired">
  population: "trial" | "membership"
  expiryDate: string
  daysRemaining: number
  headline: string
  body: string
  referralLine: string
  pricingLine: string
  ctaRenew: string
  ctaRefer: string
  settingsReferralsPath: string
}

export interface PremiumExpiredBannerPayload {
  logKey: string
  population: "trial" | "membership"
  expiryDate: string
  headline: string
  body: string
  pricingLine: string
  ctaRenew: string
}

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
  await prisma.premiumRenewalReminderLog.create({
    data: { userId, logKey, channel },
  })
}

export async function findUsersForExpiryReminderWindow(
  source: PremiumExpirySource,
  daysBeforeExpiry: number,
  now: Date = new Date(),
): Promise<Array<{ id: string; expiry: Date }>> {
  const field = timedPremiumExpiryField(source)
  const today = startOfUtcDay(now)
  const targetDay = addUtcDays(today, daysBeforeExpiry)
  const window = utcDayWindowForCalendarDate(targetDay)

  const where: Record<string, unknown> = {
    [field]: { gte: window.gte, lt: window.lt },
  }
  if (source === "membership") {
    where.subscriptionTier = "premium"
  }
  if (source === "gratis") {
    where.subscriptionTier = { not: "premium" }
  }

  const rows = await prisma.user.findMany({
    where,
    select: { id: true, [field]: true },
  })

  return rows
    .map((row) => {
      const expiry = row[field as keyof typeof row] as Date | null
      if (!expiry) return null
      return { id: row.id, expiry }
    })
    .filter((x): x is { id: string; expiry: Date } => x != null)
}

export async function findUsersForExpiredNotification(
  source: PremiumExpirySource,
  now: Date = new Date(),
): Promise<Array<{ id: string; expiry: Date }>> {
  const field = timedPremiumExpiryField(source)
  const today = startOfUtcDay(now)
  const yesterday = addUtcDays(today, -1)
  const window = utcDayWindowForCalendarDate(yesterday)

  const where: Record<string, unknown> = {
    [field]: { gte: window.gte, lt: window.lt },
  }
  if (source === "membership") {
    where.subscriptionTier = "premium"
  }
  if (source === "gratis") {
    where.subscriptionTier = { not: "premium" }
  }

  const rows = await prisma.user.findMany({
    where,
    select: { id: true, [field]: true },
  })

  return rows
    .map((row) => {
      const expiry = row[field as keyof typeof row] as Date | null
      if (!expiry || !isExpiredNotificationDay(expiry, now)) return null
      return { id: row.id, expiry }
    })
    .filter((x): x is { id: string; expiry: Date } => x != null)
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
