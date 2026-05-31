/**
 * Account Rules — user-defined automation rules for BitBudget.
 *
 * Rules are stored in the `AccountRule` table. Each rule has:
 * - A trigger (when it fires)
 * - Conditions (what it matches)
 * - Actions (what it does)
 *
 * The rule evaluator lives in `lib/rule-engine.ts` (Phase 3 — planned).
 * For now, rule execution is handled inline at each trigger point.
 */

export type RuleTrigger =
  | "on_import"
  | "on_scan"
  | "on_save"
  | "on_schedule"
  | "on_income"

export type RuleType =
  | "payee_name"
  | "auto_categorize"
  | "skip"
  | "auto_tag"
  | "summary_email"
  | "round_up"
  | "surplus_sweep"
  | "savings_floor"
  | "subscription_auto_confirm"
  | "irregular_income"
  | "redact"

export type RuleConditionOp = "eq" | "contains" | "starts_with" | "regex" | "gte" | "lte"

export interface RuleCondition {
  field: "payee" | "amount" | "type" | "source"
  op: RuleConditionOp
  value: string | number
}

export type RuleActionType =
  | "exclude"
  | "set_envelope"
  | "add_tag"
  | "rename_payee"
  | "round_up_savings"
  | "immediate_surplus_sweep"
  | "savings_floor"
  | "auto_confirm_recurring"
  | "route_as_income"
  | "redact_payee"
  | "send_summary_email"

export interface RuleAction {
  type: RuleActionType
  params: Record<string, unknown>
}

export interface AccountRule {
  id: string
  userId: string
  type: RuleType
  trigger: RuleTrigger
  priority: number
  enabled: boolean
  conditions: RuleCondition[]
  actions: RuleAction[]
  templateId?: string | null
  createdAt: string
  updatedAt: string
}

export type AccountRuleCreate = Omit<AccountRule, "id" | "userId" | "createdAt" | "updatedAt">
export type AccountRuleUpdate = Partial<Omit<AccountRule, "id" | "userId" | "type" | "createdAt" | "updatedAt">>

// ─── Rule Type Metadata ───────────────────────────────────────────────────────

export interface RuleTypeMeta {
  type: RuleType
  label: string
  description: string
  category: RuleCategory
  triggers: RuleTrigger[]
}

export type RuleCategory =
  | "import_scan"
  | "savings_sweep"
  | "recurring_pattern"
  | "privacy"

export const RULE_TYPE_META: Record<RuleType, RuleTypeMeta> = {
  payee_name: {
    type: "payee_name",
    label: "Payee name rule",
    description: "Rename a payee on import or scan to a consistent spelling",
    category: "import_scan",
    triggers: ["on_import", "on_scan"],
  },
  auto_categorize: {
    type: "auto_categorize",
    label: "Auto-categorize",
    description: "Assign an envelope when a payee matches a pattern",
    category: "import_scan",
    triggers: ["on_import", "on_scan"],
  },
  skip: {
    type: "skip",
    label: "Skip / ignore",
    description: "Exclude matching transactions from your history automatically",
    category: "import_scan",
    triggers: ["on_import", "on_scan"],
  },
  auto_tag: {
    type: "auto_tag",
    label: "Auto-tag",
    description: "Add a tag to transactions from a matching payee",
    category: "import_scan",
    triggers: ["on_import", "on_scan"],
  },
  summary_email: {
    type: "summary_email",
    label: "Summary email",
    description: "Send an email summary after each import batch",
    category: "import_scan",
    triggers: ["on_import"],
  },
  round_up: {
    type: "round_up",
    label: "Round-up savings",
    description: "Round each expense up to the nearest dollar and save the difference",
    category: "savings_sweep",
    triggers: ["on_save"],
  },
  surplus_sweep: {
    type: "surplus_sweep",
    label: "Immediate surplus sweep",
    description: "Sweep envelope overage to Savings right away instead of waiting for month-end",
    category: "savings_sweep",
    triggers: ["on_save"],
  },
  savings_floor: {
    type: "savings_floor",
    label: "Savings floor",
    description: "Never let a sweep reduce Savings below a set amount",
    category: "savings_sweep",
    triggers: ["on_schedule", "on_save"],
  },
  subscription_auto_confirm: {
    type: "subscription_auto_confirm",
    label: "Subscription auto-confirm",
    description: "Skip manual review for recurring charges you've confirmed 3+ times",
    category: "recurring_pattern",
    triggers: ["on_import"],
  },
  irregular_income: {
    type: "irregular_income",
    label: "Irregular income rule",
    description: "Treat large credits from a payee as income and trigger funding automatically",
    category: "recurring_pattern",
    triggers: ["on_import", "on_scan"],
  },
  redact: {
    type: "redact",
    label: "Redact payee",
    description: "Show a private alias instead of the real payee name in exports and shared views",
    category: "privacy",
    triggers: ["on_import", "on_scan", "on_save"],
  },
}

export const RULE_CATEGORIES: { id: RuleCategory; label: string; description: string }[] = [
  {
    id: "import_scan",
    label: "On-import & scan rules",
    description: "Automatically categorize, tag, skip, or rename transactions when they come in from imports, receipt scans, or bank forwarding.",
  },
  {
    id: "savings_sweep",
    label: "Savings & sweep rules",
    description: "Automatically route money to Savings — round up expenses, sweep envelope overages, or set a savings floor.",
  },
  {
    id: "recurring_pattern",
    label: "Recurring & pattern rules",
    description: "Auto-confirm subscriptions you trust and route irregular income to your budget automatically.",
  },
  {
    id: "privacy",
    label: "Privacy rules",
    description: "Redact sensitive payee names in exports and exclude specific transactions from analytics.",
  },
]

/** Rules for a given category (sorted by priority). */
export function rulesForCategory(rules: AccountRule[], category: RuleCategory): AccountRule[] {
  const types = Object.values(RULE_TYPE_META)
    .filter((m) => m.category === category)
    .map((m) => m.type)
  return rules
    .filter((r) => types.includes(r.type))
    .sort((a, b) => a.priority - b.priority)
}

// ─── Quick-template helpers ───────────────────────────────────────────────────

export interface QuickTemplate {
  id: string
  type: RuleType
  title: string
  description: string
  /** Plain-language outcome sentence shown on the card. */
  outcome: string
  /** Default rule shape created when the template is activated. */
  defaultRule: Omit<AccountRuleCreate, "priority">
}

export const QUICK_TEMPLATES: QuickTemplate[] = [
  {
    id: "round_up_savings",
    type: "round_up",
    title: "Round-up savings",
    description: "Every time you spend, the spare change goes to Savings.",
    outcome: "A $4.37 coffee → $0.63 credited to your Savings automatically.",
    defaultRule: {
      type: "round_up",
      trigger: "on_save",
      enabled: true,
      conditions: [{ field: "type", op: "eq", value: "expense" }],
      actions: [{ type: "round_up_savings", params: {} }],
      templateId: "round_up_savings",
    },
  },
  {
    id: "skip_transfers",
    type: "skip",
    title: "Skip bank transfers",
    description: "Automatically hide transfer and payment rows that aren't real spending.",
    outcome: 'Rows containing "TRANSFER", "ZELLE", or "PAYMENT THANK YOU" won\'t appear in your history.',
    defaultRule: {
      type: "skip",
      trigger: "on_import",
      enabled: true,
      conditions: [{ field: "payee", op: "contains", value: "TRANSFER" }],
      actions: [{ type: "exclude", params: {} }],
      templateId: "skip_transfers",
    },
  },
  {
    id: "savings_floor",
    type: "savings_floor",
    title: "Savings floor",
    description: "Protect a minimum Savings balance — sweeps won't drain below it.",
    outcome: "Your Savings balance will never fall below your chosen floor during a sweep.",
    defaultRule: {
      type: "savings_floor",
      trigger: "on_schedule",
      enabled: true,
      conditions: [],
      actions: [{ type: "savings_floor", params: { floorAmount: 500 } }],
      templateId: "savings_floor",
    },
  },
  {
    id: "surplus_sweep",
    type: "surplus_sweep",
    title: "Immediate surplus sweep",
    description: "Any envelope overage goes straight to Savings instead of waiting for month-end.",
    outcome: "When you spend less than your allotment, the leftover moves to Savings right away.",
    defaultRule: {
      type: "surplus_sweep",
      trigger: "on_save",
      enabled: true,
      conditions: [{ field: "type", op: "eq", value: "expense" }],
      actions: [{ type: "immediate_surplus_sweep", params: {} }],
      templateId: "surplus_sweep",
    },
  },
  {
    id: "redact_medical",
    type: "redact",
    title: "Redact doctor visits",
    description: 'Show "Healthcare" instead of the clinic name in exports and shared views.',
    outcome: "Any payee matching your pattern appears as your chosen alias in CSV exports.",
    defaultRule: {
      type: "redact",
      trigger: "on_save",
      enabled: true,
      conditions: [{ field: "payee", op: "contains", value: "" }],
      actions: [{ type: "redact_payee", params: { alias: "Healthcare" } }],
      templateId: "redact_medical",
    },
  },
  {
    id: "summary_email_on_import",
    type: "summary_email",
    title: "Summary email on import",
    description: "Get a quick summary emailed to you after each import batch.",
    outcome: "After importing transactions you'll receive \"You imported $X across N transactions.\"",
    defaultRule: {
      type: "summary_email",
      trigger: "on_import",
      enabled: true,
      conditions: [],
      actions: [{ type: "send_summary_email", params: { minCount: 1 } }],
      templateId: "summary_email_on_import",
    },
  },
]

/** Check whether a given template has already been activated. */
export function templateIsActive(templateId: string, rules: AccountRule[]): boolean {
  return rules.some((r) => r.templateId === templateId && r.enabled)
}
