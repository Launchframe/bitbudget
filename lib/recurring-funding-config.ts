import type { DistributionBehavior } from "@/lib/move-funds-math"
import type { MoveFundsMode } from "@/lib/move-funds"

export const RECURRING_FUNDING_KINDS = ["income_distribution", "move_funds"] as const
export type RecurringFundingKind = (typeof RECURRING_FUNDING_KINDS)[number]

export type IncomeDistributionRuleConfig = {
  distributionBehavior: DistributionBehavior
  fundOverageFromSavings: boolean
  /** Pool applied each run; when omitted or ≤0, `User.monthlyIncome` is used at execution time. */
  grossUsd?: number
  customByEnvelopeId?: Record<string, number>
}

export type MoveFundsRuleConfig = {
  mode: MoveFundsMode
  entries: { envelopeId: string; deltaUsd: number }[]
}

export type ParsedRecurringFundingConfig =
  | { kind: "income_distribution"; config: IncomeDistributionRuleConfig }
  | { kind: "move_funds"; config: MoveFundsRuleConfig }

function isDistributionBehavior(value: unknown): value is DistributionBehavior {
  return value === "set_to_budget" || value === "add_budget" || value === "custom"
}

function isMoveFundsMode(value: unknown): value is MoveFundsMode {
  return value === "balanced" || value === "independent"
}

export function parseIncomeDistributionConfig(raw: unknown): IncomeDistributionRuleConfig | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (!isDistributionBehavior(o.distributionBehavior)) return null
  if (typeof o.fundOverageFromSavings !== "boolean") return null

  let grossUsd: number | undefined
  if (o.grossUsd !== undefined) {
    if (typeof o.grossUsd !== "number" || !Number.isFinite(o.grossUsd)) return null
    grossUsd = o.grossUsd
  }

  let customByEnvelopeId: Record<string, number> | undefined
  if (o.customByEnvelopeId !== undefined) {
    if (typeof o.customByEnvelopeId !== "object" || o.customByEnvelopeId === null) return null
    customByEnvelopeId = {}
    for (const [k, v] of Object.entries(o.customByEnvelopeId as Record<string, unknown>)) {
      if (typeof v !== "number" || !Number.isFinite(v)) return null
      customByEnvelopeId[k] = v
    }
  }

  return {
    distributionBehavior: o.distributionBehavior,
    fundOverageFromSavings: o.fundOverageFromSavings,
    grossUsd,
    customByEnvelopeId,
  }
}

export function parseMoveFundsRuleConfig(raw: unknown): MoveFundsRuleConfig | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (!isMoveFundsMode(o.mode)) return null
  if (!Array.isArray(o.entries)) return null

  const entries: MoveFundsRuleConfig["entries"] = []
  for (const row of o.entries) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) return null
    const e = row as Record<string, unknown>
    if (typeof e.envelopeId !== "string" || !e.envelopeId.trim()) return null
    if (typeof e.deltaUsd !== "number" || !Number.isFinite(e.deltaUsd)) return null
    if (Math.abs(e.deltaUsd) < 0.005) continue
    entries.push({
      envelopeId: e.envelopeId.trim(),
      deltaUsd: Math.round(e.deltaUsd * 100) / 100,
    })
  }

  if (entries.length === 0) return null
  return { mode: o.mode, entries }
}

export function parseRecurringFundingConfig(
  kind: string,
  raw: unknown,
): ParsedRecurringFundingConfig | null {
  if (kind === "income_distribution") {
    const config = parseIncomeDistributionConfig(raw)
    return config ? { kind, config } : null
  }
  if (kind === "move_funds") {
    const config = parseMoveFundsRuleConfig(raw)
    return config ? { kind, config } : null
  }
  return null
}

/** Build config snapshot from the move-funds panel (irregular income schedule). */
export function incomeDistributionConfigFromPanel(params: {
  distributionBehavior: DistributionBehavior
  fundOverageFromSavings: boolean
  grossUsd: number
}): IncomeDistributionRuleConfig {
  return {
    distributionBehavior: params.distributionBehavior,
    fundOverageFromSavings: params.fundOverageFromSavings,
    grossUsd: Math.round(params.grossUsd * 100) / 100,
  }
}
