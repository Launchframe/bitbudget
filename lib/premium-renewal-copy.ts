import {
  PREMIUM_ANNUAL_SAVINGS_MONTHS,
  PREMIUM_PRICE_ANNUAL_USD,
  PREMIUM_PRICE_MONTHLY_USD,
} from "@/lib/constants"
import type { PremiumExpiryPopulation, PremiumRenewalReminderKind } from "@/lib/premium-expiry"

export interface PremiumRenewalCopy {
  headline: string
  body: string
  referralLine: string
  pricingLine: string
  ctaRenew: string
  ctaRefer: string
}

function populationLabel(population: PremiumExpiryPopulation, kind: PremiumRenewalReminderKind): string {
  if (population === "trial") {
    if (kind === "expired") return "Your free premium trial has ended"
    return "Your free premium trial is ending soon"
  }
  if (kind === "expired") return "Your premium membership has ended"
  return "Your premium membership is ending soon"
}

export function premiumRenewalCopy(
  population: PremiumExpiryPopulation,
  kind: PremiumRenewalReminderKind,
  expiryDate: string,
  daysRemaining?: number,
): PremiumRenewalCopy {
  const label = populationLabel(population, kind)
  const when =
    kind === "expired"
      ? `Your access ended after ${expiryDate}.`
      : daysRemaining != null
        ? `Your premium access ends on ${expiryDate} (${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left).`
        : `Your premium access ends on ${expiryDate}.`

  const referralLine =
    "Refer a friend who connects their bank and you can earn another free month of premium (or more, depending on your plan)."

  const pricingLine = `Renew early: $${PREMIUM_PRICE_MONTHLY_USD}/month, or $${PREMIUM_PRICE_ANNUAL_USD}/year (get ${PREMIUM_ANNUAL_SAVINGS_MONTHS} months free).`

  let body = when
  if (kind !== "expired") {
    body = `${when} ${referralLine} ${pricingLine}`
  } else {
    body = `${when} ${pricingLine} You can also refer someone new to earn bonus premium time.`
  }

  return {
    headline: label,
    body,
    referralLine,
    pricingLine,
    ctaRenew: kind === "expired" ? "Renew Premium" : "Renew early",
    ctaRefer: "Refer a friend",
  }
}

export function premiumRenewalEmailSubject(
  population: PremiumExpiryPopulation,
  kind: PremiumRenewalReminderKind,
  daysRemaining?: number,
): string {
  if (kind === "expired") {
    return population === "trial"
      ? "Your BitBudget premium trial has ended"
      : "Your BitBudget premium membership has ended"
  }
  const noun = population === "trial" ? "premium trial" : "premium membership"
  return `Your BitBudget ${noun} ends in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`
}

export function premiumRenewalNostrBody(
  population: PremiumExpiryPopulation,
  kind: PremiumRenewalReminderKind,
  expiryDate: string,
  daysRemaining?: number,
  appUrl?: string,
): string {
  const copy = premiumRenewalCopy(population, kind, expiryDate, daysRemaining)
  const link = appUrl ? ` Open BitBudget: ${appUrl}` : ""
  return `${copy.headline}. ${copy.body}${link}`
}
