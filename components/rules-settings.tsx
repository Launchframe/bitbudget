"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useApp } from "@/lib/app-context"
import {
  QUICK_TEMPLATES,
  RULE_CATEGORIES,
  RULE_TYPE_META,
  rulesForCategory,
  templateIsActive,
  type AccountRule,
  type AccountRuleCreate,
  type QuickTemplate,
  type RuleCategory,
} from "@/lib/account-rules"
import { PayeeRulesSettings } from "@/components/payee-rules-settings"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { Zap, Trash2, Loader2, ChevronDown, ChevronUp, Sparkles, Plus } from "lucide-react"

export function RulesSettings() {
  const { state, discretionaryEnvelopes, reloadAccountRules, activeTransactions } = useApp()
  const [rules, setRules] = useState<AccountRule[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AccountRule | null>(null)
  const [createCategory, setCreateCategory] = useState<RuleCategory | null>(null)
  const [expandedCategories, setExpandedCategories] = useState<Set<RuleCategory>>(
    () => new Set(["import_scan", "savings_sweep", "recurring_pattern", "privacy"]),
  )

  const loadRules = useCallback(() => {
    setLoading(true)
    fetch("/api/account-rules")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: AccountRule[]) => setRules(Array.isArray(rows) ? rows : []))
      .catch(() => setRules([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadRules()
  }, [loadRules])

  const availableTemplates = useMemo(
    () => QUICK_TEMPLATES.filter((t) => !templateIsActive(t.id, rules)),
    [rules],
  )

  const contextualTemplates = useMemo(() => {
    const currentMonth = new Date().toISOString().slice(0, 7) // YYYY-MM
    const hasExpensesThisMonth = activeTransactions.some(
      (t) => t.type === "expense" && !t.excludeFromMainHistory && t.date.startsWith(currentMonth),
    )
    const hasImportSource = activeTransactions.some(
      (t) => t.source === "plaid" || t.source === "email_forward" || t.source === "email_scan" || t.source === "notification_forward",
    )
    const hasEmailNotifications = state.communicationPreferences?.importAlerts === true

    return availableTemplates.filter((t) => {
      // Round-up savings: only when savings experience is engaged and user has expenses
      if (t.type === "round_up") {
        if (state.savingsExperience === "dismissed") return false
        if (!hasExpensesThisMonth) return false
      }
      // Surplus sweep: savings-related, hide when savings experience is dismissed
      if (t.type === "surplus_sweep" && state.savingsExperience === "dismissed") return false
      // Savings floor: savings-related, hide when savings experience is dismissed
      if (t.type === "savings_floor" && state.savingsExperience === "dismissed") return false
      // Skip transfers: most useful when the user has import-source transactions
      if (t.id === "skip_transfers" && !hasImportSource) return false
      // Redact: always show
      // Summary email: only when email notifications are enabled and user imports
      if (t.id === "summary_email_on_import") {
        if (!hasEmailNotifications || !hasImportSource) return false
      }
      return true
    })
  }, [availableTemplates, state.savingsExperience, state.communicationPreferences, activeTransactions])

  async function activateTemplate(template: QuickTemplate) {
    setBusyId(`template-${template.id}`)
    try {
      const res = await fetch("/api/account-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...template.defaultRule, priority: 0 }),
      })
      if (res.ok) {
        loadRules()
        void reloadAccountRules()
      }
    } finally {
      setBusyId(null)
    }
  }

  async function createRule(draft: AccountRuleCreate) {
    setBusyId("creating")
    try {
      const res = await fetch("/api/account-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      })
      if (res.ok) {
        loadRules()
        void reloadAccountRules()
        setCreateCategory(null)
      }
    } finally {
      setBusyId(null)
    }
  }

  async function toggleRule(rule: AccountRule) {
    setBusyId(rule.id)
    try {
      const res = await fetch(`/api/account-rules?id=${encodeURIComponent(rule.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      })
      if (res.ok) {
        const updated = (await res.json()) as AccountRule
        setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
        void reloadAccountRules()
      }
    } finally {
      setBusyId(null)
    }
  }

  async function deleteRule(rule: AccountRule) {
    setBusyId(rule.id)
    try {
      const res = await fetch(`/api/account-rules?id=${encodeURIComponent(rule.id)}`, {
        method: "DELETE",
      })
      if (res.ok) {
        setRules((prev) => prev.filter((r) => r.id !== rule.id))
        void reloadAccountRules()
      }
    } finally {
      setBusyId(null)
      setDeleteTarget(null)
    }
  }

  function toggleCategory(cat: RuleCategory) {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-10">
      {/* ── Quick templates ─────────────────────────────────────────────── */}
      {contextualTemplates.length > 0 && (
        <section>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-btc-orange" aria-hidden />
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Quick templates
            </h3>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            One-click rules tailored to how you use BitBudget. Activate any you want and edit them
            after.
          </p>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {contextualTemplates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                busy={busyId === `template-${t.id}`}
                onActivate={() => void activateTemplate(t)}
              />
            ))}
          </ul>
        </section>
      )}

      {/* ── Payee name rules (existing) ─────────────────────────────────── */}
      <section>
        <PayeeRulesSettings />
      </section>

      {/* ── Account rule categories ─────────────────────────────────────── */}
      {RULE_CATEGORIES.map((cat) => {
        const catRules = rulesForCategory(rules, cat.id)
        const isExpanded = expandedCategories.has(cat.id)

        const nonPayeeImportRules = cat.id === "import_scan"
          ? catRules.filter((r) => r.type !== "payee_name")
          : catRules

        return (
          <section key={cat.id}>
            <button
              type="button"
              onClick={() => toggleCategory(cat.id)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-[#1F1F1F] bg-[#0D0D0D] px-5 py-4 text-left"
              aria-expanded={isExpanded}
            >
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-foreground">{cat.label}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{cat.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {nonPayeeImportRules.length > 0 && (
                  <span className="rounded-full bg-btc-orange/15 px-2.5 py-0.5 text-xs font-semibold text-btc-orange">
                    {nonPayeeImportRules.length}
                  </span>
                )}
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" aria-hidden />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
                )}
              </div>
            </button>

            {isExpanded && (
              <div className="mt-3 rounded-2xl border border-[#1F1F1F] bg-[#0D0D0D] p-5">
                {loading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading…
                  </div>
                ) : nonPayeeImportRules.length === 0 ? (
                  <CategoryEmptyState category={cat.id} />
                ) : (
                  <ul className="flex flex-col gap-3">
                    {nonPayeeImportRules.map((rule) => (
                      <RuleRow
                        key={rule.id}
                        rule={rule}
                        busy={busyId === rule.id}
                        onToggle={() => void toggleRule(rule)}
                        onDelete={() => setDeleteTarget(rule)}
                      />
                    ))}
                  </ul>
                )}

                {/* Add rule button — shown for all categories */}
                <button
                  type="button"
                  onClick={() => setCreateCategory(cat.id)}
                  className="mt-4 flex items-center gap-2 rounded-lg border border-dashed border-[#333] px-4 py-2.5 text-sm text-muted-foreground hover:border-btc-orange/40 hover:text-foreground w-full justify-center"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Add rule
                </button>
              </div>
            )}
          </section>
        )
      })}

      {/* ── Create rule dialog ──────────────────────────────────────────── */}
      <Dialog open={!!createCategory} onOpenChange={(open) => { if (!open) setCreateCategory(null) }}>
        <DialogContent
          className="max-w-lg"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              Add {createCategory ? RULE_CATEGORIES.find(c => c.id === createCategory)?.label.replace("rules", "rule").replace("Rules", "Rule") : "rule"}
            </DialogTitle>
          </DialogHeader>
          {createCategory && (
            <CreateRuleForm
              category={createCategory}
              envelopes={discretionaryEnvelopes}
              tags={state.tags}
              busy={busyId === "creating"}
              onSave={(draft) => void createRule(draft)}
              onCancel={() => setCreateCategory(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ──────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this rule?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `"${RULE_TYPE_META[deleteTarget.type as keyof typeof RULE_TYPE_META]?.label ?? deleteTarget.type}" will be removed. This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteTarget) void deleteRule(deleteTarget) }}
              className="bg-red-500 hover:bg-red-600"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Create Rule Form ─────────────────────────────────────────────────────────

type RuleFormType = "skip" | "auto_categorize" | "auto_tag" | "summary_email" | "round_up" | "surplus_sweep" | "savings_floor" | "subscription_auto_confirm" | "irregular_income" | "redact"

const CATEGORY_RULE_TYPES: Record<RuleCategory, { type: RuleFormType; label: string }[]> = {
  import_scan: [
    { type: "skip", label: "Skip / ignore" },
    { type: "auto_categorize", label: "Auto-categorize" },
    { type: "auto_tag", label: "Auto-tag" },
    { type: "summary_email", label: "Summary email" },
  ],
  savings_sweep: [
    { type: "round_up", label: "Round-up savings" },
    { type: "surplus_sweep", label: "Immediate surplus sweep" },
    { type: "savings_floor", label: "Savings floor" },
  ],
  recurring_pattern: [
    { type: "subscription_auto_confirm", label: "Subscription auto-confirm" },
    { type: "irregular_income", label: "Irregular income rule" },
  ],
  privacy: [
    { type: "redact", label: "Redact payee" },
  ],
}

function CreateRuleForm({
  category,
  envelopes,
  tags,
  busy,
  onSave,
  onCancel,
}: {
  category: RuleCategory
  envelopes: { id: string; name: string }[]
  tags: { id: string; name: string }[]
  busy: boolean
  onSave: (draft: AccountRuleCreate) => void
  onCancel: () => void
}) {
  const types = CATEGORY_RULE_TYPES[category]
  const [ruleType, setRuleType] = useState<RuleFormType>(types[0]?.type ?? "skip")
  const [payeePattern, setPayeePattern] = useState("")
  const [patternOp, setPatternOp] = useState<"contains" | "eq" | "starts_with">("contains")
  const [envelopeId, setEnvelopeId] = useState("")
  const [tagName, setTagName] = useState("")
  const [redactAlias, setRedactAlias] = useState("")
  const [floorAmount, setFloorAmount] = useState("500")
  const [minAmount, setMinAmount] = useState("500")
  const [error, setError] = useState<string | null>(null)

  function buildDraft(): AccountRuleCreate | null {
    const conditions = []
    const actions = []

    // Payee condition (for rules that need it)
    const needsPayee = ["skip", "auto_categorize", "auto_tag", "subscription_auto_confirm", "irregular_income", "redact"].includes(ruleType)
    if (needsPayee) {
      const p = payeePattern.trim()
      if (!p) {
        setError("Enter a payee pattern.")
        return null
      }
      conditions.push({ field: "payee" as const, op: patternOp as "contains" | "eq" | "starts_with", value: p })
    }

    switch (ruleType) {
      case "skip":
        actions.push({ type: "exclude" as const, params: {} })
        return { type: "skip", trigger: "on_import" as const, enabled: true, priority: 0, conditions, actions }
      case "auto_categorize":
        if (!envelopeId) { setError("Select an envelope."); return null }
        actions.push({ type: "set_envelope" as const, params: { envelopeId } })
        return { type: "auto_categorize", trigger: "on_import" as const, enabled: true, priority: 0, conditions, actions }
      case "auto_tag":
        if (!tagName.trim()) { setError("Enter a tag name."); return null }
        actions.push({ type: "add_tag" as const, params: { tag: tagName.trim() } })
        return { type: "auto_tag", trigger: "on_import" as const, enabled: true, priority: 0, conditions, actions }
      case "summary_email":
        actions.push({ type: "send_summary_email" as const, params: { minCount: 1 } })
        return { type: "summary_email", trigger: "on_import" as const, enabled: true, priority: 0, conditions, actions }
      case "round_up":
        conditions.push({ field: "type" as const, op: "eq" as const, value: "expense" })
        actions.push({ type: "round_up_savings" as const, params: {} })
        return { type: "round_up", trigger: "on_save" as const, enabled: true, priority: 0, conditions, actions }
      case "surplus_sweep":
        conditions.push({ field: "type" as const, op: "eq" as const, value: "expense" })
        actions.push({ type: "immediate_surplus_sweep" as const, params: {} })
        return { type: "surplus_sweep", trigger: "on_save" as const, enabled: true, priority: 0, conditions, actions }
      case "savings_floor": {
        const floor = parseFloat(floorAmount)
        if (isNaN(floor) || floor < 0) { setError("Enter a valid floor amount."); return null }
        actions.push({ type: "savings_floor" as const, params: { floorAmount: floor } })
        return { type: "savings_floor", trigger: "on_schedule" as const, enabled: true, priority: 0, conditions, actions }
      }
      case "subscription_auto_confirm":
        actions.push({ type: "auto_confirm_recurring" as const, params: {} })
        return { type: "subscription_auto_confirm", trigger: "on_import" as const, enabled: true, priority: 0, conditions, actions }
      case "irregular_income": {
        const min = parseFloat(minAmount)
        if (isNaN(min) || min <= 0) { setError("Enter a valid minimum amount."); return null }
        conditions.push({ field: "amount" as const, op: "gte" as const, value: min })
        actions.push({ type: "route_as_income" as const, params: {} })
        return { type: "irregular_income", trigger: "on_import" as const, enabled: true, priority: 0, conditions, actions }
      }
      case "redact":
        if (!redactAlias.trim()) { setError("Enter a display alias."); return null }
        actions.push({ type: "redact_payee" as const, params: { alias: redactAlias.trim() } })
        return { type: "redact", trigger: "on_save" as const, enabled: true, priority: 0, conditions, actions }
      default:
        return null
    }
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const draft = buildDraft()
    if (draft) onSave(draft)
  }

  const needsPayee = ["skip", "auto_categorize", "auto_tag", "subscription_auto_confirm", "irregular_income", "redact"].includes(ruleType)

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-5 pt-2">
      {/* Rule type selector */}
      {types.length > 1 && (
        <div className="flex flex-col gap-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Rule type</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {types.map((t) => (
              <button
                key={t.type}
                type="button"
                onClick={() => { setRuleType(t.type); setError(null) }}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left text-sm transition-all",
                  ruleType === t.type
                    ? "border-btc-orange/50 bg-btc-orange/10 text-foreground"
                    : "border-[#2A2A2A] bg-[#181818] text-muted-foreground hover:border-[#3A3A3A] hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Payee pattern */}
      {needsPayee && (
        <div className="flex flex-col gap-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">
            When payee
          </Label>
          <div className="flex gap-2">
            <select
              value={patternOp}
              onChange={(e) => setPatternOp(e.target.value as typeof patternOp)}
              className="rounded-md border border-[#333] bg-[#1A1A1A] px-3 py-2 text-sm text-foreground shrink-0"
            >
              <option value="contains">contains</option>
              <option value="starts_with">starts with</option>
              <option value="eq">is exactly</option>
            </select>
            <Input
              value={payeePattern}
              onChange={(e) => setPayeePattern(e.target.value)}
              placeholder={ruleType === "skip" ? "e.g. TRANSFER, ZELLE" : "e.g. Netflix"}
              className="border-[#333] bg-[#1A1A1A] text-foreground"
              autoComplete="off"
            />
          </div>
        </div>
      )}

      {/* Rule-specific fields */}
      {ruleType === "auto_categorize" && (
        <div className="flex flex-col gap-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Assign to envelope</Label>
          <select
            value={envelopeId}
            onChange={(e) => setEnvelopeId(e.target.value)}
            className="rounded-md border border-[#333] bg-[#1A1A1A] px-3 py-2 text-sm text-foreground"
          >
            <option value="">Select an envelope…</option>
            {envelopes.map((env) => (
              <option key={env.id} value={env.id}>{env.name}</option>
            ))}
          </select>
        </div>
      )}

      {ruleType === "auto_tag" && (
        <div className="flex flex-col gap-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Tag to add</Label>
          <Input
            value={tagName}
            onChange={(e) => setTagName(e.target.value)}
            placeholder="e.g. Subscriptions"
            className="border-[#333] bg-[#1A1A1A] text-foreground"
            list="existing-tags-list"
            autoComplete="off"
          />
          <datalist id="existing-tags-list">
            {tags.map((t) => <option key={t.id} value={t.name} />)}
          </datalist>
        </div>
      )}

      {ruleType === "redact" && (
        <div className="flex flex-col gap-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">
            Show as (display alias)
          </Label>
          <Input
            value={redactAlias}
            onChange={(e) => setRedactAlias(e.target.value)}
            placeholder="e.g. Healthcare, Personal"
            className="border-[#333] bg-[#1A1A1A] text-foreground"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            The original payee stays encrypted; only exported or shared views show this alias.
          </p>
        </div>
      )}

      {ruleType === "savings_floor" && (
        <div className="flex flex-col gap-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">
            Minimum Savings balance ($)
          </Label>
          <Input
            type="number"
            min="0"
            step="1"
            value={floorAmount}
            onChange={(e) => setFloorAmount(e.target.value)}
            className="border-[#333] bg-[#1A1A1A] text-foreground"
          />
          <p className="text-xs text-muted-foreground">
            Sweeps will stop early if Savings would fall below this amount.
          </p>
        </div>
      )}

      {ruleType === "irregular_income" && (
        <div className="flex flex-col gap-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">
            Minimum credit amount ($)
          </Label>
          <Input
            type="number"
            min="1"
            step="1"
            value={minAmount}
            onChange={(e) => setMinAmount(e.target.value)}
            className="border-[#333] bg-[#1A1A1A] text-foreground"
          />
          <p className="text-xs text-muted-foreground">
            Credits from this payee at or above this amount will trigger income funding.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-btc-orange px-4 py-2 text-sm font-semibold text-[#0D0D0D] hover:bg-btc-orange/90 disabled:opacity-50"
        >
          {busy ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </span>
          ) : (
            "Save rule"
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-[#333] px-4 py-2 text-sm text-muted-foreground hover:bg-[#1A1A1A] hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// ─── Template card ────────────────────────────────────────────────────────────

function TemplateCard({
  template,
  busy,
  onActivate,
}: {
  template: QuickTemplate
  busy: boolean
  onActivate: () => void
}) {
  return (
    <li className="flex flex-col rounded-2xl border border-[#1F1F1F] bg-[#0D0D0D] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Zap className="mt-0.5 h-4 w-4 shrink-0 text-btc-orange" aria-hidden />
          <h4 className="text-sm font-semibold text-foreground">{template.title}</h4>
        </div>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{template.description}</p>
      <p className="mt-2 rounded-lg border border-[#1F1F1F] bg-[#111] px-3 py-2 text-xs text-muted-foreground">
        {template.outcome}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={onActivate}
        className="mt-4 rounded-lg bg-btc-orange px-4 py-2 text-sm font-semibold text-[#0D0D0D] hover:bg-btc-orange/90 disabled:opacity-50"
      >
        {busy ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Activating…
          </span>
        ) : (
          "Activate"
        )}
      </button>
    </li>
  )
}

// ─── Rule row ─────────────────────────────────────────────────────────────────

function RuleRow({
  rule,
  busy,
  onToggle,
  onDelete,
}: {
  rule: AccountRule
  busy: boolean
  onToggle: () => void
  onDelete: () => void
}) {
  const meta = RULE_TYPE_META[rule.type as keyof typeof RULE_TYPE_META]
  const label = meta?.label ?? rule.type
  const conditionSummary = summarizeConditions(rule)

  return (
    <li
      className={cn(
        "flex items-start justify-between gap-4 rounded-xl border border-[#222] bg-[#111] px-4 py-3",
        !rule.enabled && "opacity-60",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {conditionSummary && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{conditionSummary}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Switch
                id={`rule-enabled-${rule.id}`}
                checked={rule.enabled}
                onCheckedChange={onToggle}
                aria-label={rule.enabled ? "Disable rule" : "Enable rule"}
              />
              <Label htmlFor={`rule-enabled-${rule.id}`} className="sr-only">
                {rule.enabled ? "Enabled" : "Disabled"}
              </Label>
            </div>
            <button
              type="button"
              onClick={onDelete}
              className="rounded-md p-1.5 text-muted-foreground/40 transition-colors hover:bg-white/5 hover:text-red-400"
              title="Delete rule"
              aria-label="Delete rule"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </li>
  )
}

// ─── Category empty state ─────────────────────────────────────────────────────

function CategoryEmptyState({ category }: { category: RuleCategory }) {
  const hints: Record<RuleCategory, string> = {
    import_scan: "Auto-categorize, skip, or tag transactions from future imports. Add a rule or use a Quick Template above to get started.",
    savings_sweep: "Automate round-ups, surplus sweeps, or a savings floor. Use a Quick Template above or add a rule.",
    recurring_pattern: "Auto-confirm trusted subscriptions or route irregular income automatically.",
    privacy: "Redact sensitive payee names in exports. Use a Quick Template above or add a rule.",
  }
  return (
    <p className="text-sm text-muted-foreground">{hints[category]}</p>
  )
}

// ─── Condition summary ────────────────────────────────────────────────────────

function summarizeConditions(rule: AccountRule): string {
  const conds = rule.conditions as { field: string; op: string; value: string | number }[] | undefined
  if (!conds || conds.length === 0) return ""

  const parts = conds.map((c) => {
    const opLabel: Record<string, string> = {
      eq: "is",
      contains: "contains",
      starts_with: "starts with",
      regex: "matches",
      gte: "≥",
      lte: "≤",
    }
    return `${c.field} ${opLabel[c.op] ?? c.op} "${c.value}"`
  })
  return parts.join(" & ")
}
