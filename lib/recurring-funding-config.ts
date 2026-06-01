import type { DistributionBehavior } from "@/lib/rebalance-math"
import type { RebalanceMode } from "@/lib/rebalance-envelopes"

export const RECURRING_FUNDING_KINDS = ["income_distribution", "rebalance"] as const
export type RecurringFundingKind = (typeof RECURRING_FUNDING_KINDS)[number]

export type IncomeDistributionRuleConfig = {
  distributionBehavior: DistributionBehavior
  fundOverageFromSavings: boolean
  /** Pool applied each run; when omitted or ≤0, `User.monthlyIncome` is used at execution time. */
  grossUsd?: number
  customByEnvelopeId?: Record<string, number>
}

export type RebalanceRuleConfig = {
  mode: RebalanceMode
  entries: { envelopeId: string; deltaUsd: number }[]
}

/** @deprecated Use RebalanceRuleConfig */
export type MoveFundsRuleConfig = RebalanceRuleConfig

export type ParsedRecurringFundingConfig =
  | { kind: "income_distribution"; config: IncomeDistributionRuleConfig }
  | { kind: "rebalance"; config: RebalanceRuleConfig }

function isDistributionBehavior(value: unknown): value is DistributionBehavior {
  return value === "set_to_budget" || value === "add_budget" || value === "custom"
}

function isRebalanceMode(value: unknown): value is RebalanceMode {
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

export function parseRebalanceRuleConfig(raw: unknown): RebalanceRuleConfig | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (!isRebalanceMode(o.mode)) return null
  if (!Array.isArray(o.entries)) return null

  const entries: RebalanceRuleConfig["entries"] = []
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

/** @deprecated Use parseRebalanceRuleConfig */
export const parseMoveFundsRuleConfig = parseRebalanceRuleConfig

export function parseRecurringFundingConfig(
  kind: string,
  raw: unknown,
): ParsedRecurringFundingConfig | null {
  if (kind === "income_distribution") {
    const config = parseIncomeDistributionConfig(raw)
    return config ? { kind, config } : null
  }
  if (kind === "rebalance" || kind === "move_funds") {
    const config = parseRebalanceRuleConfig(raw)
    return config ? { kind: "rebalance", config } : null
  }
  return null
}

/** Build config snapshot from the move-funds panel (irregular income schedule). */
export function incomeDistributionConfigFromPanel(params: {
  distributionBehavior: DistributionBehavior
  fundOverageFromSavings: boolean
  grossUsd: number
  customByEnvelopeId?: Record<string, number>
}): IncomeDistributionRuleConfig {
  const config: IncomeDistributionRuleConfig = {
    distributionBehavior: params.distributionBehavior,
    fundOverageFromSavings: params.fundOverageFromSavings,
    grossUsd: Math.round(params.grossUsd * 100) / 100,
  }
  if (params.customByEnvelopeId && Object.keys(params.customByEnvelopeId).length > 0) {
    config.customByEnvelopeId = params.customByEnvelopeId
  }
  return config
}
