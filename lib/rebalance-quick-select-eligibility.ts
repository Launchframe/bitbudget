import { clampRebalanceDeltas, type EnvelopeForRebalanceClamp } from "@/lib/rebalance-math"
import {
  applyRebalanceQuickSelect,
  type EnvelopeForQuickSelect,
  type RebalanceQuickSelectId,
} from "@/lib/rebalance-quick-selects"

const EPS = 0.005

export interface RebalanceQuickSelectEligibilityInput {
  envelopes: readonly EnvelopeForQuickSelect[]
  clampContext: readonly EnvelopeForRebalanceClamp[]
  monthlyIncome: number
  savingsBal: number
  creditMultiplier: number
}

function clampedQuickSelectDeltas(
  id: RebalanceQuickSelectId,
  input: RebalanceQuickSelectEligibilityInput,
): Record<string, number> {
  const poolUsd =
    id === "proportional_fill" && input.monthlyIncome > 0
      ? Math.min(input.monthlyIncome, Math.max(0, input.savingsBal))
      : undefined
  const raw = applyRebalanceQuickSelect(id, input.envelopes, {
    userDefaultSweepPolicy: null,
    userDefaultCapMultiplier: null,
    poolUsd,
  })
  return clampRebalanceDeltas(raw, input.clampContext, {
    creditMultiplier: input.creditMultiplier,
    savingsBalance: input.savingsBal,
  })
}

export function quickSelectWouldMoveDeltas(
  id: RebalanceQuickSelectId,
  input: RebalanceQuickSelectEligibilityInput,
): boolean {
  const clamped = clampedQuickSelectDeltas(id, input)
  for (const v of Object.values(clamped)) {
    if (Number.isFinite(v) && Math.abs(v) > EPS) return true
  }
  return false
}

export function countIneligibleQuickSelects(input: RebalanceQuickSelectEligibilityInput): number {
  const ids: RebalanceQuickSelectId[] = [
    "relieve_overfunded",
    "restore_health",
    "sweep_to_savings",
    "proportional_fill",
    "zero_base",
  ]
  let n = 0
  for (const id of ids) {
    if (!quickSelectWouldMoveDeltas(id, input)) n++
  }
  return n
}
