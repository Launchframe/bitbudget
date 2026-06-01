import type { PremiumRenewalReminderKind } from "@/lib/premium-expiry"

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

function isRenewalPrompt(value: unknown): value is PremiumRenewalPromptPayload {
  if (!value || typeof value !== "object") return false
  const row = value as Record<string, unknown>
  return typeof row.logKey === "string" && typeof row.headline === "string"
}

function isExpiredBanner(value: unknown): value is PremiumExpiredBannerPayload {
  if (!value || typeof value !== "object") return false
  const row = value as Record<string, unknown>
  return typeof row.logKey === "string" && typeof row.headline === "string"
}

export function parsePremiumRenewalSettings(settings: unknown): {
  premiumRenewalPrompt: PremiumRenewalPromptPayload | null
  premiumExpiredBanner: PremiumExpiredBannerPayload | null
} {
  if (!settings || typeof settings !== "object") {
    return { premiumRenewalPrompt: null, premiumExpiredBanner: null }
  }
  const row = settings as Record<string, unknown>
  const prompt = row.premiumRenewalPrompt
  const expiredBanner = row.premiumExpiredBanner
  return {
    premiumRenewalPrompt: isRenewalPrompt(prompt) ? prompt : null,
    premiumExpiredBanner: isExpiredBanner(expiredBanner) ? expiredBanner : null,
  }
}
