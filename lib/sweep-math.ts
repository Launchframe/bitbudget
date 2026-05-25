import {
  SWEEP_POLICY_CAPPED,
  SWEEP_POLICY_CARRY_FORWARD,
  SWEEP_POLICY_RESET,
} from "@/lib/constants"

export const DEFAULT_SWEEP_CAP_MULTIPLIER = 1.5

/** Month pacing marker (matches Envelopes page progress bar): 100% on day 1, 0% on last day. */
export function monthProgressMarkerPct(asOf = new Date()): number {
  const dayOfMonth = asOf.getDate()
  const daysInMonth = new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0).getDate()
  return daysInMonth > 1 ? (1 - (dayOfMonth - 1) / (daysInMonth - 1)) * 100 : 100
}

/** Target envelope balance to align health % with the month pacing marker (Reset policy). */
export function targetBalanceForMonthPace(monthlyAllotment: number, asOf = new Date()): number {
  if (!Number.isFinite(monthlyAllotment) || monthlyAllotment <= 0) return 0
  const pct = monthProgressMarkerPct(asOf)
  return Math.round(((monthlyAllotment * pct) / 100) * 100) / 100
}

export function resolveEffectiveSweepPolicy(
  envelopePolicy: string | null | undefined,
  userDefaultPolicy: string | null | undefined,
): string {
  if (
    envelopePolicy === SWEEP_POLICY_RESET ||
    envelopePolicy === SWEEP_POLICY_CARRY_FORWARD ||
    envelopePolicy === SWEEP_POLICY_CAPPED
  ) {
    return envelopePolicy
  }
  if (
    userDefaultPolicy === SWEEP_POLICY_RESET ||
    userDefaultPolicy === SWEEP_POLICY_CARRY_FORWARD ||
    userDefaultPolicy === SWEEP_POLICY_CAPPED
  ) {
    return userDefaultPolicy
  }
  return SWEEP_POLICY_RESET
}

/** Pure sweep amount for one discretionary envelope. */
export function sweepAmountForEnvelope(params: {
  balance: number
  policy: string
  monthlyAllotment: number
  capMultiplier: number
}): number {
  const { balance, policy, monthlyAllotment, capMultiplier } = params
  if (!Number.isFinite(balance) || balance <= 0) return 0

  if (policy === SWEEP_POLICY_CARRY_FORWARD) return 0

  const effectiveCapMultiplier =
    policy === SWEEP_POLICY_RESET ? 1 : policy === SWEEP_POLICY_CAPPED ? capMultiplier : null
  if (effectiveCapMultiplier != null) {
    const cap = effectiveCapMultiplier * monthlyAllotment
    const amount = Math.max(0, balance - cap)
    return Math.round(amount * 100) / 100
  }

  return 0
}

/** Suggested manual sweep for one envelope (respects sweep policy; user may still edit up to balance). */
export function suggestedManualSweepAmount(params: {
  balance: number
  policy: string
  monthlyAllotment: number
  capMultiplier: number
  asOf?: Date
}): number {
  const { balance, policy, monthlyAllotment, capMultiplier } = params
  if (!Number.isFinite(balance) || balance <= 0) return 0

  if (policy === SWEEP_POLICY_CAPPED || policy === SWEEP_POLICY_RESET) {
    if (policy === SWEEP_POLICY_RESET) {
      const target = targetBalanceForMonthPace(monthlyAllotment, params.asOf)
      return Math.round(Math.max(0, balance - target) * 100) / 100
    }
    return sweepAmountForEnvelope({ balance, policy, monthlyAllotment, capMultiplier })
  }

  if (policy === SWEEP_POLICY_CARRY_FORWARD) {
    if (!Number.isFinite(monthlyAllotment) || monthlyAllotment <= 0) return 0
    return Math.round(Math.max(0, balance - monthlyAllotment) * 100) / 100
  }

  return 0
}

export function resolveSweepCapMultiplier(
  envelopeCap: number | string | null | undefined,
  userDefaultCap: number | string | null | undefined,
): number {
  if (envelopeCap != null) return Number(envelopeCap)
  if (userDefaultCap != null) return Number(userDefaultCap)
  return DEFAULT_SWEEP_CAP_MULTIPLIER
}
