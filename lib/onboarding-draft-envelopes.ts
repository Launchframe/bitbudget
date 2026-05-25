import { isReservedSavingsEnvelopeName, SYSTEM_ENVELOPE_ROLE_SAVINGS } from "@/lib/constants"

/** Onboarding budget grids are discretionary only — never the system Savings envelope. */
export function isOnboardingDraftBudgetEnvelope(env: {
  name: string
  systemRole?: string | null
}): boolean {
  if (env.systemRole === SYSTEM_ENVELOPE_ROLE_SAVINGS) return false
  return !isReservedSavingsEnvelopeName(env.name)
}

export function withoutSystemSavingsEnvelope<T extends { name: string; systemRole?: string | null }>(
  envelopes: T[],
): T[] {
  return envelopes.filter(isOnboardingDraftBudgetEnvelope)
}
