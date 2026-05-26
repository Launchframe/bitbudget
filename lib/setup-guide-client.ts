import { SYSTEM_ENVELOPE_ROLE_SAVINGS } from "@/lib/constants"
import type { Envelope } from "@/lib/data"
import { getCurrentMonthKey } from "@/lib/data"

/** Stable signature for setup-status refetch when allotments change. */
export function discretionaryAllotmentSignature(
  envelopes: readonly Envelope[],
): string {
  return envelopes
    .filter((e) => !e.archived && e.systemRole !== SYSTEM_ENVELOPE_ROLE_SAVINGS)
    .map((e) => `${e.id}:${e.monthlyAllotment}`)
    .sort()
    .join("|")
}

export async function fetchSavingsGoalSetForMonth(
  monthKey: string = getCurrentMonthKey(),
): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/user/savings-goals?from=${encodeURIComponent(monthKey)}&to=${encodeURIComponent(monthKey)}`,
    )
    if (!res.ok) return false
    const body = (await res.json()) as { goals?: Array<{ targetAmount?: number }> }
    return (body.goals?.[0]?.targetAmount ?? 0) > 0
  } catch {
    return false
  }
}

export type SetupGuideSettingsTab = "general" | "integrations"

function scrollWhenPresent(selector: string, attemptsLeft = 12): void {
  const el = document.querySelector(selector)
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" })
    return
  }
  if (attemptsLeft <= 0) return
  requestAnimationFrame(() => scrollWhenPresent(selector, attemptsLeft - 1))
}

export function focusSettingsSection(tab: SetupGuideSettingsTab): void {
  window.dispatchEvent(
    new CustomEvent("bitbudget-walkthrough-settings-tab", { detail: { tab } }),
  )
  const selector =
    tab === "integrations"
      ? '[data-walkthrough="settings-connections"]'
      : "#settings-linked-sign-in"
  requestAnimationFrame(() => scrollWhenPresent(selector))
}
