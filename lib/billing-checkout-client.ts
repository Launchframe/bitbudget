export type PremiumCheckoutPlan = "monthly" | "annual"

export type PremiumCheckoutResponse = {
  checkoutUrl?: string | null
  simulated?: boolean
  premiumTrialUntil?: string
  effectiveTier?: string
  message?: string
  reason?: string
  recorded?: boolean
}

export async function postPremiumCheckout(
  plan: PremiumCheckoutPlan,
): Promise<{ ok: boolean; data: PremiumCheckoutResponse }> {
  const res = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  })
  const data = (await res.json()) as PremiumCheckoutResponse
  return { ok: res.ok, data }
}

export function formatPremiumTrialEnd(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}
