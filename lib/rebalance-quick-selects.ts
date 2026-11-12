import {
  DEFAULT_SWEEP_CAP_MULTIPLIER,
  resolveEffectiveSweepPolicy,
  resolveSweepCapMultiplier,
  suggestedManualSweepAmount,
  targetBalanceForMonthPace,
} from "@/lib/sweep-math"

export type RebalanceQuickSelectId =
  | "relieve_overfunded"
  | "restore_health"
  | "sweep_to_savings"
  | "proportional_fill"
  | "zero_base"

export interface EnvelopeForQuickSelect {
  id: string
  monthlyAllotment: number
  currentBalance: number
  sweepPolicy: string | null | undefined
  sweepCapMultiplier: number | string | null | undefined
}

export function applyRebalanceQuickSelect(
  id: RebalanceQuickSelectId,
  envelopes: readonly EnvelopeForQuickSelect[],
  options: {
    userDefaultSweepPolicy: string | null | undefined
    userDefaultCapMultiplier: number | string | null | undefined
    poolUsd?: number
    asOf?: Date
  },
): Record<string, number> {
  const deltas: Record<string, number> = {}
  const asOf = options.asOf ?? new Date()

  switch (id) {
    case "relieve_overfunded": {
      for (const env of envelopes) {
        const policy = resolveEffectiveSweepPolicy(env.sweepPolicy, options.userDefaultSweepPolicy)
        const capMult = resolveSweepCapMultiplier(env.sweepCapMultiplier, options.userDefaultCapMultiplier)
        const sweep = suggestedManualSweepAmount({
          balance: env.currentBalance,
          policy,
          monthlyAllotment: env.monthlyAllotment,
          capMultiplier: capMult || DEFAULT_SWEEP_CAP_MULTIPLIER,
          asOf,
        })
        if (sweep > 0.005) deltas[env.id] = -sweep
      }
      return deltas
    }
    case "restore_health": {
      for (const env of envelopes) {
        if (env.monthlyAllotment <= 0) continue
        const target = targetBalanceForMonthPace(env.monthlyAllotment, asOf)
        const need = Math.round((target - env.currentBalance) * 100) / 100
        if (need > 0.005) deltas[env.id] = need
      }
      return deltas
    }
    case "sweep_to_savings":
    case "zero_base": {
      for (const env of envelopes) {
        if (env.currentBalance > 0.005) {
          deltas[env.id] = -Math.round(env.currentBalance * 100) / 100
        }
      }
      return deltas
    }
    case "proportional_fill": {
      const pool = Number.isFinite(options.poolUsd) ? options.poolUsd! : 0
      if (pool <= 0) return deltas
      const totalAllot = envelopes.reduce((s, e) => s + Math.max(0, e.monthlyAllotment), 0)
      if (totalAllot <= 0) return deltas
      let remainingPool = Math.round(pool * 100) / 100
      const eligible = envelopes.filter((e) => e.monthlyAllotment > 0)
      for (let i = 0; i < eligible.length; i++) {
        const env = eligible[i]!
        const share =
          i === eligible.length - 1
            ? remainingPool
            : Math.round(((pool * env.monthlyAllotment) / totalAllot) * 100) / 100
        remainingPool = Math.round((remainingPool - share) * 100) / 100
        if (share > 0.005) deltas[env.id] = share
      }
      return deltas
    }
    default: {
      const _x: never = id
      return _x
    }
  }
}

export const REBALANCE_QUICK_SELECTS: { id: RebalanceQuickSelectId; label: string }[] = [
  { id: "relieve_overfunded", label: "Relieve overfunded" },
  { id: "restore_health", label: "Restore health" },
  { id: "sweep_to_savings", label: "Sweep to Savings" },
  { id: "proportional_fill", label: "Proportional fill" },
  { id: "zero_base", label: "Zero balances" },
]
