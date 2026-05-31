/**
 * Client-side rule engine for BitBudget.
 *
 * Evaluates `AccountRule[]` against a transaction and returns the set of
 * mutations to apply. Mutations are returned (not applied) so callers can
 * decide how to merge them with existing form state.
 *
 * Supports triggers:
 *  - on_import / on_scan — runs before transaction is saved
 *  - on_save             — runs after transaction is saved (side-effect rules)
 */

import type { AccountRule, RuleCondition, RuleTrigger } from "@/lib/account-rules"

// ─── Condition evaluation ─────────────────────────────────────────────────────

function normalizeStr(s: string): string {
  return s.trim().toLowerCase()
}

function evalCondition(cond: RuleCondition, ctx: RuleEvalContext): boolean {
  const fieldValue = ctx[cond.field]
  if (fieldValue === undefined || fieldValue === null) return false

  const strVal = String(fieldValue)
  const condVal = String(cond.value)

  switch (cond.op) {
    case "eq":
      return normalizeStr(strVal) === normalizeStr(condVal)
    case "contains":
      return normalizeStr(strVal).includes(normalizeStr(condVal))
    case "starts_with":
      return normalizeStr(strVal).startsWith(normalizeStr(condVal))
    case "regex": {
      try {
        return new RegExp(cond.value as string, "i").test(strVal)
      } catch {
        return false
      }
    }
    case "gte":
      return Number(fieldValue) >= Number(cond.value)
    case "lte":
      return Number(fieldValue) <= Number(cond.value)
    default:
      return false
  }
}

function matchesConditions(conditions: RuleCondition[], ctx: RuleEvalContext): boolean {
  if (conditions.length === 0) return true
  return conditions.every((c) => evalCondition(c, ctx))
}

// ─── Mutation shapes ──────────────────────────────────────────────────────────

export interface RuleMutation {
  /** Rule that produced this mutation. */
  ruleId: string
  ruleType: string
  /** Envelope to assign (auto_categorize). */
  envelopeId?: string
  /** Tags to add (auto_tag). */
  addTags?: string[]
  /** Set excludeFromMainHistory = true (skip). */
  exclude?: boolean
  /** Rename payee (payee_name action from the AccountRule type — distinct from PayeeNameRule). */
  renamedPayee?: string
  /** Route this transaction as irregular income (route_as_income action). */
  routeAsIncome?: boolean
  /** Auto-confirm recurring — skip the pending review queue. */
  autoConfirm?: boolean
  /** Display alias for redact rule (replaces payee in exports/analytics). */
  redactAlias?: string
}

// ─── Evaluation context ───────────────────────────────────────────────────────

export interface RuleEvalContext {
  payee: string
  amount?: number
  type?: "expense" | "credit"
  source?: string
}

// ─── On-import / on-scan evaluator ────────────────────────────────────────────

/**
 * Evaluate all enabled rules for the given trigger against `ctx`.
 * Returns a list of mutations (one per matching rule, in priority order).
 * The caller decides whether to apply them (respecting `manuallySet` fields).
 */
export function evaluateRules(
  trigger: RuleTrigger,
  ctx: RuleEvalContext,
  rules: AccountRule[],
): RuleMutation[] {
  const mutations: RuleMutation[] = []

  const sorted = [...rules]
    .filter((r) => r.enabled && (r.trigger === trigger || r.trigger === "on_import" && trigger === "on_scan"))
    .sort((a, b) => a.priority - b.priority)

  for (const rule of sorted) {
    const conds = (rule.conditions ?? []) as RuleCondition[]
    if (!matchesConditions(conds, ctx)) continue

    const mutation: RuleMutation = { ruleId: rule.id, ruleType: rule.type }

    for (const action of (rule.actions ?? []) as { type: string; params: Record<string, unknown> }[]) {
      switch (action.type) {
        case "exclude":
          mutation.exclude = true
          break
        case "set_envelope":
          if (typeof action.params.envelopeId === "string") {
            mutation.envelopeId = action.params.envelopeId
          }
          break
        case "add_tag":
          if (typeof action.params.tag === "string") {
            mutation.addTags = [...(mutation.addTags ?? []), action.params.tag]
          }
          break
        case "rename_payee":
          if (typeof action.params.canonicalPayee === "string") {
            mutation.renamedPayee = action.params.canonicalPayee
          }
          break
        case "route_as_income":
          mutation.routeAsIncome = true
          break
        case "auto_confirm_recurring":
          mutation.autoConfirm = true
          break
        case "redact_payee":
          if (typeof action.params.alias === "string") {
            mutation.redactAlias = action.params.alias
          }
          break
        case "send_summary_email":
          // handled server-side post-import batch; no client mutation needed
          break
        default:
          break
      }
    }

    mutations.push(mutation)
  }

  return mutations
}

/** Merge mutations into a transaction delta (last envelope/rename wins; tags merge). */
export interface TransactionRuleDelta {
  envelopeId?: string
  excludeFromMainHistory?: boolean
  tags?: string[]
  payee?: string
  routeAsIncome?: boolean
  autoConfirm?: boolean
  /** Display alias for redacted payees (does not change the encrypted original). */
  redactAlias?: string
  appliedRuleIds: string[]
}

export function mergeRuleMutations(mutations: RuleMutation[], existingTags: string[] = []): TransactionRuleDelta {
  const delta: TransactionRuleDelta = { appliedRuleIds: [] }
  const tagSet = new Set(existingTags)

  for (const m of mutations) {
    delta.appliedRuleIds.push(m.ruleId)
    if (m.envelopeId) delta.envelopeId = m.envelopeId
    if (m.exclude) delta.excludeFromMainHistory = true
    if (m.addTags) for (const t of m.addTags) tagSet.add(t)
    if (m.renamedPayee) delta.payee = m.renamedPayee
    if (m.routeAsIncome) delta.routeAsIncome = true
    if (m.autoConfirm) delta.autoConfirm = true
    if (m.redactAlias) delta.redactAlias = m.redactAlias
  }

  if (tagSet.size > 0) delta.tags = [...tagSet]
  return delta
}

// ─── Round-up helpers (on_save) ───────────────────────────────────────────────
/** Calculate the round-up cents for an expense amount. Returns 0 if already a whole dollar. */
export function calculateRoundUpCents(amountCents: number): number {
  const remainder = amountCents % 100
  if (remainder === 0) return 0
  return 100 - remainder
}

/** Returns true if any enabled round-up rule applies to an expense. */
export function hasRoundUpRule(rules: AccountRule[]): boolean {
  return rules.some(
    (r) => r.enabled && r.type === "round_up" && (r.trigger === "on_save" || r.trigger === "on_income"),
  )
}

// ─── Savings floor helpers ────────────────────────────────────────────────────

/** Get the savings floor amount from the first enabled savings_floor rule (0 if none). */
export function getSavingsFloorAmount(rules: AccountRule[]): number {
  const rule = rules.find((r) => r.enabled && r.type === "savings_floor")
  if (!rule) return 0
  const actions = rule.actions as { type: string; params: Record<string, unknown> }[]
  const floorAction = actions.find((a) => a.type === "savings_floor")
  const floor = floorAction?.params?.floorAmount
  return typeof floor === "number" ? floor : 0
}

// ─── Redact helpers ───────────────────────────────────────────────────────────

/**
 * Returns the display payee for a transaction, applying redact rules if any match.
 * The encrypted original is untouched; only the UI display is affected.
 */
export function getRedactedPayee(payee: string, rules: AccountRule[]): string {
  const mutations = evaluateRules("on_save", { payee }, rules)
  const delta = mergeRuleMutations(mutations)
  return delta.redactAlias ?? payee
}
