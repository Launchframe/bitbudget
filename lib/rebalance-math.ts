import { allocationTopUpAmount } from "@/lib/budget-period"
import { splitUsdProportionalByAllotment } from "@/lib/allotment-proportional-split"

export type DistributionBehavior =
  | "set_to_budget"
  | "add_budget"
  | "split_income_proportional"
  | "custom"

export interface EnvelopeForDistribution {
  id: string
  monthlyAllotment: number
  currentMonthBalance: number
}

export interface DistributionLine {
  envelopeId: string
  deltaUsd: number
  fromSavings: number
}

export type DistributionInvalidReason =
  | "no_income"
  | "insufficient_income"
  | "insufficient_savings"
  | "no_split_targets"

export interface EnvelopeSliderLimits {
  maxDebit: number
  maxCredit: number
}

export interface EnvelopeForRebalanceClamp {
  id: string
  monthlyAllotment: number
  currentBalance: number
}

export function rebalanceLimitsForEnvelope(
  env: Pick<EnvelopeForRebalanceClamp, "monthlyAllotment" | "currentBalance">,
  creditMultiplier: number,
): EnvelopeSliderLimits {
  return {
    maxDebit: Math.max(0, env.currentBalance),
    maxCredit: Math.max(0, env.monthlyAllotment * creditMultiplier),
  }
}

/** Clamp one envelope delta to debit/credit slider bounds. */
export function clampRebalanceDelta(delta: number, limits: EnvelopeSliderLimits): number {
  return clampDelta(delta, limits)
}

/**
 * Clamp quick-select / slider deltas per envelope and cap total credits by Savings balance
 * (money into envelopes cannot exceed what's in Savings).
 */
export function clampRebalanceDeltas(
  raw: Record<string, number>,
  envelopes: readonly EnvelopeForRebalanceClamp[],
  options: { creditMultiplier: number; savingsBalance: number },
): Record<string, number> {
  const limitsById = new Map<string, EnvelopeSliderLimits>()
  const result: Record<string, number> = {}

  for (const env of envelopes) {
    const limits = rebalanceLimitsForEnvelope(env, options.creditMultiplier)
    limitsById.set(env.id, limits)
    if (!(env.id in raw)) continue
    const clamped = clampDelta(raw[env.id]!, limits)
    if (Math.abs(clamped) > 0.005) result[env.id] = clamped
  }

  const savings = Math.max(0, options.savingsBalance)
  let creditTotal = 0
  for (const v of Object.values(result)) {
    if (v > 0) creditTotal += v
  }
  if (creditTotal > savings + 0.015 && creditTotal > 0) {
    const scale = savings / creditTotal
    for (const env of envelopes) {
      const id = env.id
      const cur = result[id]
      if (cur === undefined || cur <= 0) continue
      const lim = limitsById.get(id)!
      const scaled = clampDelta(cur * scale, lim)
      if (Math.abs(scaled) > 0.005) result[id] = scaled
      else delete result[id]
    }
  }

  return result
}

export function deltaForBehavior(
  behavior: DistributionBehavior,
  monthlyAllotment: number,
  currentMonthBalance: number,
  customUsd?: number,
): number {
  switch (behavior) {
    case "set_to_budget":
      return allocationTopUpAmount({ monthlyAllotment, currentMonthBalance })
    case "add_budget":
      return Number.isFinite(monthlyAllotment) && monthlyAllotment > 0
        ? Math.round(monthlyAllotment * 100) / 100
        : 0
    case "custom":
      return Number.isFinite(customUsd) && customUsd! > 0 ? Math.round(customUsd! * 100) / 100 : 0
    case "split_income_proportional":
      return 0
    default: {
      const _exhaustive: never = behavior
      return _exhaustive
    }
  }
}

export function computeDistribution(params: {
  behavior: DistributionBehavior
  envelopes: readonly EnvelopeForDistribution[]
  grossUsd: number
  savingsBalance: number
  fundOverageFromSavings: boolean
  customByEnvelopeId?: ReadonlyMap<string, number>
}): {
  lines: DistributionLine[]
  invalid: boolean
  invalidReason: DistributionInvalidReason | null
  totalNeed: number
  fromIncome: number
  fromSavings: number
} {
  const gross = params.grossUsd
  if (!Number.isFinite(gross) || gross <= 0) {
    return {
      lines: [],
      invalid: true,
      invalidReason: "no_income",
      totalNeed: 0,
      fromIncome: 0,
      fromSavings: 0,
    }
  }

  if (params.behavior === "split_income_proportional") {
    const map = splitUsdProportionalByAllotment(
      gross,
      params.envelopes.map((e) => ({ id: e.id, monthlyAllotment: e.monthlyAllotment })),
    )
    if (map.size === 0) {
      return {
        lines: [],
        invalid: true,
        invalidReason: "no_split_targets",
        totalNeed: 0,
        fromIncome: 0,
        fromSavings: 0,
      }
    }
    const lines: DistributionLine[] = []
    let totalNeed = 0
    for (const [envelopeId, deltaUsd] of map) {
      lines.push({ envelopeId, deltaUsd, fromSavings: 0 })
      totalNeed += deltaUsd
    }
    totalNeed = Math.round(totalNeed * 100) / 100
    return {
      lines,
      invalid: false,
      invalidReason: null,
      totalNeed,
      fromIncome: totalNeed,
      fromSavings: 0,
    }
  }

  const lines: DistributionLine[] = []
  let totalNeed = 0

  for (const env of params.envelopes) {
    const custom =
      params.behavior === "custom" ? params.customByEnvelopeId?.get(env.id) : undefined
    const delta = deltaForBehavior(
      params.behavior,
      env.monthlyAllotment,
      env.currentMonthBalance,
      custom,
    )
    if (delta > 0) {
      lines.push({ envelopeId: env.id, deltaUsd: delta, fromSavings: 0 })
      totalNeed += delta
    }
  }

  totalNeed = Math.round(totalNeed * 100) / 100
  if (totalNeed <= 0) {
    return {
      lines: [],
      invalid: false,
      invalidReason: null,
      totalNeed: 0,
      fromIncome: 0,
      fromSavings: 0,
    }
  }

  const fromIncome = Math.min(gross, totalNeed)
  let fromSavings = 0
  const shortfall = Math.round((totalNeed - fromIncome) * 100) / 100

  if (shortfall > 0) {
    if (!params.fundOverageFromSavings) {
      return {
        lines,
        invalid: true,
        invalidReason: "insufficient_income",
        totalNeed,
        fromIncome,
        fromSavings: 0,
      }
    }
    const savings = Number.isFinite(params.savingsBalance) ? params.savingsBalance : 0
    if (shortfall > savings + 0.015) {
      return {
        lines,
        invalid: true,
        invalidReason: "insufficient_savings",
        totalNeed,
        fromIncome,
        fromSavings: 0,
      }
    }
    fromSavings = shortfall
  }

  if (fromIncome > 0 && lines.length > 0) {
    let remainingIncomeCents = Math.round(fromIncome * 100)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      const lineCents = Math.round(line.deltaUsd * 100)
      const share =
        i === lines.length - 1
          ? remainingIncomeCents
          : Math.min(lineCents, Math.floor((fromIncome * lineCents) / totalNeed))
      remainingIncomeCents -= share
      line.fromSavings = (lineCents - share) / 100
    }
  } else if (fromSavings > 0) {
    for (const line of lines) {
      line.fromSavings = line.deltaUsd
    }
  }

  return {
    lines,
    invalid: false,
    invalidReason: null,
    totalNeed,
    fromIncome,
    fromSavings,
  }
}

export function validateExplicitAllocations(
  grossUsd: number,
  allocations: readonly { amountUsd: number }[],
): boolean {
  if (!Number.isFinite(grossUsd) || grossUsd <= 0) return false
  let sum = 0
  for (const row of allocations) {
    if (!Number.isFinite(row.amountUsd) || row.amountUsd <= 0) return false
    sum += row.amountUsd
  }
  return sum <= grossUsd + 0.015
}

export type DistributionResult = ReturnType<typeof computeDistribution>

export function fundedAmountByEnvelopeId(dist: DistributionResult): Map<string, number> {
  const map = new Map<string, number>()
  if (dist.totalNeed <= 0) return map

  if (!dist.invalid) {
    for (const line of dist.lines) {
      const fromIncome = Math.round((line.deltaUsd - line.fromSavings) * 100) / 100
      if (fromIncome > 0.005) map.set(line.envelopeId, fromIncome)
    }
    return map
  }

  const fromIncome = dist.fromIncome
  if (fromIncome <= 0) return map

  let remainingCents = Math.round(fromIncome * 100)
  for (let i = 0; i < dist.lines.length; i++) {
    const line = dist.lines[i]!
    const lineCents = Math.round(line.deltaUsd * 100)
    const shareCents =
      i === dist.lines.length - 1
        ? remainingCents
        : Math.min(lineCents, Math.floor((fromIncome * lineCents) / dist.totalNeed))
    remainingCents -= shareCents
    if (shareCents > 0) map.set(line.envelopeId, shareCents / 100)
  }
  return map
}

export function fundablePreviewRows(
  dist: DistributionResult,
  label: string,
): { envelopeId: string; deltaUsd: number; behaviorLabel: string }[] {
  if (dist.invalid) return []
  const funded = fundedAmountByEnvelopeId(dist)
  return dist.lines
    .filter((line) => (funded.get(line.envelopeId) ?? 0) > 0.005)
    .map((line) => ({
      envelopeId: line.envelopeId,
      deltaUsd: funded.get(line.envelopeId) ?? line.deltaUsd,
      behaviorLabel: label,
    }))
}

export function requestedPreviewRows(
  dist: DistributionResult,
  label: string,
): { envelopeId: string; deltaUsd: number; behaviorLabel: string }[] {
  return dist.lines
    .filter((line) => line.deltaUsd > 0.005)
    .map((line) => ({
      envelopeId: line.envelopeId,
      deltaUsd: line.deltaUsd,
      behaviorLabel: label,
    }))
}

function clampDelta(delta: number, limits: EnvelopeSliderLimits): number {
  const min = -Math.max(0, limits.maxDebit)
  const max = Math.max(0, limits.maxCredit)
  return Math.round(Math.min(max, Math.max(min, delta)) * 100) / 100
}

function sumDeltas(deltas: Record<string, number>, ids: readonly string[]): number {
  return ids.reduce((s, id) => s + (deltas[id] ?? 0), 0)
}

/** Balanced mode: keep sum of envelope deltas at zero (pool-only; Savings untouched). */
export function applyBalancedSliderChange(
  changedId: string,
  nextDelta: number,
  deltas: Record<string, number>,
  envelopeIds: readonly string[],
  limitsById: ReadonlyMap<string, EnvelopeSliderLimits>,
): Record<string, number> {
  const limits = limitsById.get(changedId) ?? { maxDebit: 0, maxCredit: 0 }
  const clampedChanged = clampDelta(nextDelta, limits)
  const others = envelopeIds.filter((id) => id !== changedId)
  const next: Record<string, number> = { ...deltas, [changedId]: clampedChanged }

  const targetOtherSum = -clampedChanged
  let otherSum = sumDeltas(next, others)
  const adjustment = Math.round((targetOtherSum - otherSum) * 100) / 100

  if (Math.abs(adjustment) < 0.005) return next

  const weights = others.map((id) => {
    const lim = limitsById.get(id) ?? { maxDebit: 0, maxCredit: 0 }
    const cur = next[id] ?? 0
    if (adjustment > 0) {
      return Math.max(0, lim.maxCredit - cur)
    }
    return Math.max(0, cur + lim.maxDebit)
  })
  const weightTotal = weights.reduce((s, w) => s + w, 0)

  if (weightTotal <= 0.005) {
    return next
  }

  let remaining = adjustment
  for (let i = 0; i < others.length; i++) {
    const id = others[i]!
    const lim = limitsById.get(id) ?? { maxDebit: 0, maxCredit: 0 }
    const share =
      i === others.length - 1
        ? remaining
        : Math.round(((adjustment * weights[i]!) / weightTotal) * 100) / 100
    remaining = Math.round((remaining - share) * 100) / 100
    const cur = next[id] ?? 0
    next[id] = clampDelta(cur + share, lim)
  }

  otherSum = sumDeltas(next, others)
  const residual = Math.round((targetOtherSum - otherSum) * 100) / 100
  if (Math.abs(residual) > 0.02 && others.length > 0) {
    const lastId = others[others.length - 1]!
    const lim = limitsById.get(lastId) ?? { maxDebit: 0, maxCredit: 0 }
    next[lastId] = clampDelta((next[lastId] ?? 0) + residual, lim)
  }

  return next
}
