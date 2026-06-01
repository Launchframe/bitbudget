import { allocationTopUpAmount } from "@/lib/budget-period"

export type DistributionBehavior = "set_to_budget" | "add_budget" | "custom"

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

/** Sum explicit envelope allocation amounts; must not exceed gross. */
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
