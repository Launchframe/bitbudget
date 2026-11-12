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
  return (
    typeof row.logKey === "string" &&
    (row.kind === 14 || row.kind === 3 || row.kind === 1) &&
    (row.population === "trial" || row.population === "membership") &&
    typeof row.expiryDate === "string" &&
    typeof row.daysRemaining === "number" &&
    typeof row.headline === "string" &&
    typeof row.body === "string" &&
    typeof row.referralLine === "string" &&
    typeof row.pricingLine === "string" &&
    typeof row.ctaRenew === "string" &&
    typeof row.ctaRefer === "string" &&
    typeof row.settingsReferralsPath === "string"
  )
}

function isExpiredBanner(value: unknown): value is PremiumExpiredBannerPayload {
  if (!value || typeof value !== "object") return false
  const row = value as Record<string, unknown>
  return (
    typeof row.logKey === "string" &&
    (row.population === "trial" || row.population === "membership") &&
    typeof row.expiryDate === "string" &&
    typeof row.headline === "string" &&
    typeof row.body === "string" &&
    typeof row.pricingLine === "string" &&
    typeof row.ctaRenew === "string"
  )
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
