"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useApp } from "@/lib/app-context"
import { formatUsd, getCurrentMonthKey, getEnvelopeBalanceAllTime } from "@/lib/data"
import {
  SAVINGS_EXPERIENCE_DISMISSED,
  SAVINGS_EXPERIENCE_ENGAGED,
  SAVINGS_GOLD_ACCENT,
  SWEEP_POLICY_CAPPED,
  SWEEP_POLICY_CARRY_FORWARD,
  SWEEP_POLICY_RESET,
} from "@/lib/constants"
import {
  SAVINGS_GOAL_DEFAULT_PERIOD,
} from "@/lib/savings-goal"
import {
  computeGoalStreak,
  formatPeriodKeyLabel,
  type SavingsGoalRow,
} from "@/lib/savings-ui-metrics"
import {
  buildSweepPolicyHint,
  pickSweepExampleEnvelope,
  type SweepPolicy,
} from "@/lib/sweep-policy-hints"
import { IrregularIncomeDialog } from "@/components/irregular-income-dialog"
import { SavingsGoalsWalkthroughDialog } from "@/components/savings-goals-walkthrough-dialog"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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
  ChevronDown,
  Flame,
  Info,
  Landmark,
  Loader2,
} from "lucide-react"

const SWEEP_POLICY_LABELS: Record<SweepPolicy, string> = {
  [SWEEP_POLICY_RESET]: "Reset each payday",
  [SWEEP_POLICY_CARRY_FORWARD]: "Carry forward",
  [SWEEP_POLICY_CAPPED]: "Cap surplus",
}

const FORWARD_OVERRIDE_MONTHS = 6

function shiftPeriodKey(periodKey: string, deltaMonths: number): string {
  if (periodKey === SAVINGS_GOAL_DEFAULT_PERIOD) return periodKey
  const [y, m] = periodKey.split("-").map(Number)
  const d = new Date(y, m - 1 + deltaMonths, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function graceDaysRemaining(graceEndsAt: string | null | undefined): number | null {
  if (!graceEndsAt) return null
  const end = Date.parse(graceEndsAt)
  if (!Number.isFinite(end)) return null
  const diff = Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000))
  return Math.max(0, diff)
}

function WhySavingsExplainer({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-lg bg-[#1A1A1A] px-4 py-3 text-sm font-medium text-foreground hover:bg-[#222] transition-colors">
        <span>Why Savings?</span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3 text-sm text-muted-foreground space-y-2 px-1">
        <p>
          We believe in the core financial principle of paying yourself first. Tracking your savings is a core facet of this mode of thinking, and gives you a true ledger of your finances.
        </p>
        <p>
          That is why BitBudget tracks expenses as a ledger. Your money does not appear just so it can be spent — your income is what recharges your Savings. Envelopes are spending buckets; filling them necessarily draws down on your Savings.
        </p>
        <p>
          Study after study shows that people who think of their money as savings rather than a paycheck are significantly more likely to keep to a consistent budget. Savings Tracking is designed to do just that, and to encourage you every step of the way.
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function SettingsSavingsCard() {
  const { state, discretionaryEnvelopes, activeTransactions, setSavingsExperience, editEnvelope } = useApp()

  const engaged = state.savingsExperience !== SAVINGS_EXPERIENCE_DISMISSED
  const monthKey = getCurrentMonthKey()

  const [dismissOpen, setDismissOpen] = useState(false)
  const [dismissSaving, setDismissSaving] = useState(false)

  const [defaultGoal, setDefaultGoal] = useState(0)
  const [defaultGoalDraft, setDefaultGoalDraft] = useState(0)
  const [defaultGoalSaving, setDefaultGoalSaving] = useState(false)
  const [defaultGoalError, setDefaultGoalError] = useState<string | null>(null)

  const [goalRows, setGoalRows] = useState<SavingsGoalRow[]>([])
  const [goalsLoading, setGoalsLoading] = useState(false)
  const [monthDrafts, setMonthDrafts] = useState<Record<string, string>>({})
  const [monthSaving, setMonthSaving] = useState<string | null>(null)
  const [overridesOpen, setOverridesOpen] = useState(false)
  const [walkthroughOpen, setWalkthroughOpen] = useState(false)

  const [sweepDefaultPolicy, setSweepDefaultPolicy] = useState<SweepPolicy>(SWEEP_POLICY_RESET)
  const [sweepCapMultiplier, setSweepCapMultiplier] = useState(1.5)
  const [sweepSaving, setSweepSaving] = useState(false)

  const loadSavingsData = useCallback(async () => {
    setGoalsLoading(true)
    // Load past closed rows for streak; overrides table only shows current month forward.
    const from = shiftPeriodKey(monthKey, -12)
    const to = shiftPeriodKey(monthKey, FORWARD_OVERRIDE_MONTHS)
    try {
      const [defaultRes, listRes, settingsRes] = await Promise.all([
        fetch(`/api/user/savings-goal?periodKey=${encodeURIComponent(SAVINGS_GOAL_DEFAULT_PERIOD)}`),
        fetch(`/api/user/savings-goals?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
        fetch("/api/user/settings"),
      ])

      if (defaultRes.ok) {
        const row = (await defaultRes.json()) as { targetAmount?: number }
        const amt = row.targetAmount ?? 0
        setDefaultGoal(amt)
        setDefaultGoalDraft(amt)
      }

      if (listRes.ok) {
        const list = (await listRes.json()) as { goals?: SavingsGoalRow[] }
        setGoalRows(list.goals ?? [])
      }

      if (settingsRes.ok) {
        const settings = (await settingsRes.json()) as {
          sweepDefaultPolicy?: string
          sweepDefaultCapMultiplier?: number | null
        }
        if (
          settings.sweepDefaultPolicy === SWEEP_POLICY_RESET ||
          settings.sweepDefaultPolicy === SWEEP_POLICY_CARRY_FORWARD ||
          settings.sweepDefaultPolicy === SWEEP_POLICY_CAPPED
        ) {
          setSweepDefaultPolicy(settings.sweepDefaultPolicy)
        }
        if (
          settings.sweepDefaultCapMultiplier != null &&
          Number.isFinite(settings.sweepDefaultCapMultiplier)
        ) {
          setSweepCapMultiplier(settings.sweepDefaultCapMultiplier)
        }
      }
    } catch {
      /* optional enrichment */
    } finally {
      setGoalsLoading(false)
    }
  }, [monthKey])

  useEffect(() => {
    if (engaged) void loadSavingsData()
  }, [engaged, loadSavingsData])

  const closedGoals = useMemo(
    () => goalRows.filter((g) => g.closedAt && g.periodKey !== SAVINGS_GOAL_DEFAULT_PERIOD),
    [goalRows],
  )
  const streak = computeGoalStreak(closedGoals)

  const tablePeriodKeys = useMemo(() => {
    const keys: string[] = []
    for (let i = 0; i <= FORWARD_OVERRIDE_MONTHS; i++) {
      keys.push(shiftPeriodKey(monthKey, i))
    }
    return keys
  }, [monthKey])

  const rowForPeriod = useCallback(
    (periodKey: string): SavingsGoalRow | undefined => goalRows.find((g) => g.periodKey === periodKey),
    [goalRows],
  )

  const sweepExampleEnvelope = useMemo(
    () =>
      pickSweepExampleEnvelope(discretionaryEnvelopes, (id) =>
        getEnvelopeBalanceAllTime(activeTransactions, id),
      ),
    [discretionaryEnvelopes, activeTransactions],
  )

  const sweepPolicyHint = useMemo(
    () =>
      buildSweepPolicyHint({
        policy: sweepDefaultPolicy,
        capMultiplier: sweepCapMultiplier,
        example: sweepExampleEnvelope,
      }),
    [sweepDefaultPolicy, sweepCapMultiplier, sweepExampleEnvelope],
  )

  const saveDefaultGoal = async () => {
    setDefaultGoalError(null)
    setDefaultGoalSaving(true)
    try {
      const res = await fetch("/api/user/savings-goal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodKey: SAVINGS_GOAL_DEFAULT_PERIOD, targetAmount: defaultGoalDraft }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setDefaultGoalError(typeof body.error === "string" ? body.error : "Could not save default goal.")
        return
      }
      const amt = (body as { targetAmount?: number }).targetAmount ?? defaultGoalDraft
      setDefaultGoal(amt)
      setDefaultGoalDraft(amt)
    } catch {
      setDefaultGoalError("Network error — try again.")
    } finally {
      setDefaultGoalSaving(false)
    }
  }

  const saveMonthOverride = async (periodKey: string) => {
    const raw = monthDrafts[periodKey]
    const amount = raw != null ? parseFloat(raw) : NaN
    if (!Number.isFinite(amount) || amount < 0) return

    const existing = rowForPeriod(periodKey)
    if (existing?.editability === "closed") return
    if (existing?.editability === "upward_only" && amount <= (existing.targetAmount ?? 0)) return

    setMonthSaving(periodKey)
    try {
      const res = await fetch("/api/user/savings-goal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodKey, targetAmount: amount }),
      })
      if (res.ok) {
        await loadSavingsData()
        setMonthDrafts((prev) => {
          const next = { ...prev }
          delete next[periodKey]
          return next
        })
      }
    } finally {
      setMonthSaving(null)
    }
  }

  const saveSweepDefaults = async (policy: SweepPolicy, cap?: number) => {
    setSweepSaving(true)
    try {
      const res = await fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sweepDefaultPolicy: policy,
          ...(policy === SWEEP_POLICY_CAPPED
            ? { sweepDefaultCapMultiplier: cap ?? sweepCapMultiplier }
            : {}),
        }),
      })
      if (res.ok) {
        setSweepDefaultPolicy(policy)
        if (policy === SWEEP_POLICY_CAPPED && cap != null) setSweepCapMultiplier(cap)
      }
    } finally {
      setSweepSaving(false)
    }
  }

  const saveEnvelopeSweep = async (
    envelopeId: string,
    policy: SweepPolicy | "default",
    cap?: number | null,
  ) => {
    if (policy === "default") {
      await editEnvelope(envelopeId, {
        sweepPolicy: sweepDefaultPolicy,
        sweepCapMultiplier:
          sweepDefaultPolicy === SWEEP_POLICY_CAPPED ? sweepCapMultiplier : null,
      })
      return
    }
    await editEnvelope(envelopeId, {
      sweepPolicy: policy,
      sweepCapMultiplier:
        policy === SWEEP_POLICY_CAPPED ? (cap ?? sweepCapMultiplier) : null,
    })
  }

  const confirmDismiss = async () => {
    setDismissSaving(true)
    try {
      const res = await fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          savingsExperience: SAVINGS_EXPERIENCE_DISMISSED,
          sweepDefaultPolicy: SWEEP_POLICY_CARRY_FORWARD,
        }),
      })
      if (res.ok) {
        await setSavingsExperience(SAVINGS_EXPERIENCE_DISMISSED)
        setSweepDefaultPolicy(SWEEP_POLICY_CARRY_FORWARD)
        setDismissOpen(false)
      }
    } finally {
      setDismissSaving(false)
    }
  }

  const handleTrackingToggle = (checked: boolean) => {
    if (checked) {
      void setSavingsExperience(SAVINGS_EXPERIENCE_ENGAGED)
      return
    }
    setDismissOpen(true)
  }

  return (
    <div className="p-6 bg-[#0D0D0D] rounded-2xl">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-[#D4AF37]/10">
          <Landmark className="h-5 w-5 text-[#D4AF37]" />
        </div>
        <h3 className="text-lg font-semibold text-foreground">Savings tracking</h3>
      </div>

      <p className="text-sm text-muted-foreground mb-3">
        Pay yourself first. A monthly savings goal helps you see whether your Savings balance is growing—and
        builds a streak when you keep hitting it.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mb-4 border-[#D4AF37]/40 text-[#D4AF37] hover:bg-[#D4AF37]/10 hover:text-[#D4AF37]"
        onClick={() => setWalkthroughOpen(true)}
      >
        How it works
      </Button>
      <SavingsGoalsWalkthroughDialog open={walkthroughOpen} onOpenChange={setWalkthroughOpen} />

      <div className="flex items-center justify-between gap-4 rounded-lg bg-[#1A1A1A] px-4 py-3 mb-4">
        <span className="text-sm text-foreground">Show Savings tracking</span>
        <Switch
          checked={engaged}
          onCheckedChange={handleTrackingToggle}
          aria-label="Enable Savings tracking"
        />
      </div>

      {!engaged ? (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Savings tracking is off. Your Savings envelope still receives income; only the motivational UI is hidden.
            Envelope sweep policy is set to carry forward.
          </p>
          <WhySavingsExplainer defaultOpen />
          <Button
            type="button"
            className="bg-[#D4AF37] text-[#0D0D0D] hover:bg-[#D4AF37]/90"
            onClick={() => void setSavingsExperience(SAVINGS_EXPERIENCE_ENGAGED)}
          >
            Turn on Savings tracking
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {streak > 0 && (
            <div
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[#1A1A1A]"
              style={{ color: SAVINGS_GOLD_ACCENT }}
            >
              <Flame className="h-3.5 w-3.5" aria-hidden />
              {streak} month{streak !== 1 ? "s" : ""} hitting your goal
            </div>
          )}

          <div className="rounded-lg bg-[#1A1A1A] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">My monthly goal</span>
              <span className="text-sm font-semibold" style={{ color: SAVINGS_GOLD_ACCENT }}>
                {formatUsd(defaultGoalDraft)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Your default monthly target.
            </p>
            <Slider
              min={0}
              max={Math.max(5000, defaultGoalDraft, defaultGoal) * 1.2}
              step={25}
              value={[defaultGoalDraft]}
              onValueChange={(v) => setDefaultGoalDraft(v[0] ?? 0)}
              aria-label="Default monthly savings goal"
            />
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">$</span>
              <Input
                type="number"
                min={0}
                step={25}
                value={defaultGoalDraft}
                onChange={(e) => setDefaultGoalDraft(parseFloat(e.target.value) || 0)}
                className="bg-[#0D0D0D] border-[#333] h-9 max-w-[140px]"
                aria-label="Default goal amount in dollars"
              />
              <Button
                type="button"
                size="sm"
                disabled={defaultGoalSaving || defaultGoalDraft === defaultGoal}
                className="bg-[#D4AF37] text-[#0D0D0D] hover:bg-[#D4AF37]/90 ml-auto"
                onClick={() => void saveDefaultGoal()}
              >
                {defaultGoalSaving ? "Saving…" : "Save"}
              </Button>
            </div>
            {defaultGoalError && (
              <p className="text-sm text-amber-400/95" role="alert">
                {defaultGoalError}
              </p>
            )}

            <Collapsible open={overridesOpen} onOpenChange={setOverridesOpen}>
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-lg border border-[#252525] bg-[#0D0D0D] px-3 py-2.5 text-sm text-foreground hover:bg-[#141414] transition-colors">
                <span>Upcoming goals</span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${overridesOpen ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3 space-y-2">
                <p className="text-xs text-muted-foreground px-0.5">
                  Set a different target up to {FORWARD_OVERRIDE_MONTHS} months in advance.
                </p>
                {goalsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Loading goals…
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-[#252525]">
                    <table className="w-full text-sm min-w-[280px]">
                      <thead>
                        <tr className="border-b border-[#252525] text-left text-muted-foreground">
                          <th className="px-3 py-2 font-medium">Month</th>
                          <th className="px-3 py-2 font-medium">Target</th>
                          <th className="px-3 py-2 font-medium">Status</th>
                          <th className="px-3 py-2 font-medium w-20" />
                        </tr>
                      </thead>
                      <tbody>
                        {tablePeriodKeys.map((periodKey) => {
                          const row = rowForPeriod(periodKey)
                          const isFuture = periodKey > monthKey
                          const editability =
                            row?.editability ?? (isFuture ? "editable" : "editable")
                          const graceDays = graceDaysRemaining(row?.graceEndsAt)
                          const draftVal = monthDrafts[periodKey] ?? String(row?.targetAmount ?? defaultGoal)
                          const readOnly = editability === "closed"

                          return (
                            <tr key={periodKey} className="border-b border-[#252525] last:border-0">
                              <td className="px-3 py-2 text-foreground whitespace-nowrap">
                                {formatPeriodKeyLabel(periodKey)}
                                {periodKey === monthKey && (
                                  <span className="ml-1.5 text-xs text-muted-foreground">(current)</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {readOnly ? (
                                  <span>{formatUsd(row?.targetAmount ?? 0)}</span>
                                ) : (
                                  <Input
                                    type="number"
                                    min={0}
                                    step={25}
                                    value={draftVal}
                                    onChange={(e) =>
                                      setMonthDrafts((prev) => ({ ...prev, [periodKey]: e.target.value }))
                                    }
                                    className="bg-[#0D0D0D] border-[#333] h-8 w-28"
                                    aria-label={`Goal target for ${formatPeriodKeyLabel(periodKey)}`}
                                  />
                                )}
                              </td>
                              <td className="px-3 py-2 text-xs text-muted-foreground">
                                {row?.closedAt ? (
                                  <>
                                    {row.achievedGoal ? "Hit goal" : "Missed"} · saved{" "}
                                    {formatUsd(row.actualSavedAmount ?? 0)}
                                    {row.progressPct != null && ` (${Math.round(row.progressPct * 100)}%)`}
                                  </>
                                ) : editability === "upward_only" ? (
                                  "Raise only"
                                ) : graceDays != null && periodKey === monthKey ? (
                                  `Grace: ${graceDays}d left`
                                ) : isFuture ? (
                                  "Not started"
                                ) : (
                                  "Open"
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {!readOnly && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 px-2 text-xs"
                                    disabled={monthSaving === periodKey}
                                    onClick={() => void saveMonthOverride(periodKey)}
                                  >
                                    {monthSaving === periodKey ? "…" : "Save"}
                                  </Button>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          </div>

          <div className="rounded-lg bg-[#1A1A1A] p-4 space-y-4">
            <div>
              <h4 className="text-sm font-medium text-foreground">Sweep policy</h4>
              <p className="text-xs text-muted-foreground mt-1">
                On each payday, leftover envelope balances can move into Savings. Set a default for new envelopes;
                override individual envelopes below.
              </p>
            </div>

            <div className="rounded-lg bg-[#0D0D0D] border border-[#222] p-4 space-y-3">
              <div>
                <h5 className="text-sm font-medium text-foreground">Default behavior</h5>
                <p className="text-xs text-muted-foreground mt-1">
                  Applies to new envelopes and any envelope using the default policy.
                </p>
              </div>

              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label="Default sweep behavior"
                aria-describedby="sweep-default-hint"
              >
                {(Object.keys(SWEEP_POLICY_LABELS) as SweepPolicy[]).map((policy) => (
                  <button
                    key={policy}
                    type="button"
                    disabled={sweepSaving}
                    aria-pressed={sweepDefaultPolicy === policy}
                    onClick={() => void saveSweepDefaults(policy)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      sweepDefaultPolicy === policy
                        ? "text-[#0D0D0D]"
                        : "text-muted-foreground hover:text-foreground bg-[#1A1A1A]"
                    }`}
                    style={
                      sweepDefaultPolicy === policy
                        ? { backgroundColor: SAVINGS_GOLD_ACCENT }
                        : undefined
                    }
                  >
                    {SWEEP_POLICY_LABELS[policy]}
                  </button>
                ))}
              </div>

              <div
                id="sweep-default-hint"
                className="flex items-start gap-3 p-3 rounded-xl bg-[#D4AF37]/10 border border-[#D4AF37]/20"
              >
                <Info className="h-4 w-4 shrink-0 mt-0.5" style={{ color: SAVINGS_GOLD_ACCENT }} aria-hidden />
                <div className="text-sm leading-snug min-w-0">
                  <p className="text-foreground">{sweepPolicyHint.description}</p>
                  {sweepPolicyHint.example && (
                    <p className="text-muted-foreground mt-2">{sweepPolicyHint.example}</p>
                  )}
                </div>
              </div>

              {sweepDefaultPolicy === SWEEP_POLICY_CAPPED && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Cap multiplier</span>
                  <Input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={sweepCapMultiplier}
                    onChange={(e) => setSweepCapMultiplier(parseFloat(e.target.value) || 1.5)}
                    onBlur={() => void saveSweepDefaults(SWEEP_POLICY_CAPPED, sweepCapMultiplier)}
                    className="bg-[#1A1A1A] border-[#333] h-8 w-24"
                    aria-label="Default sweep cap multiplier"
                  />
                  <span className="text-xs text-muted-foreground">× monthly allotment</span>
                </div>
              )}
            </div>

            {discretionaryEnvelopes.length > 0 && (
              <div className="space-y-2">
                <h5 className="text-sm font-medium text-foreground">Per-envelope overrides</h5>
                <div className="overflow-x-auto rounded-lg border border-[#222]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#222] text-left text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Envelope</th>
                        <th className="px-3 py-2 font-medium">Policy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {discretionaryEnvelopes.map((env) => {
                        const effectivePolicy = (env.sweepPolicy ?? SWEEP_POLICY_RESET) as SweepPolicy
                        return (
                          <tr key={env.id} className="border-b border-[#222] last:border-0">
                            <td className="px-3 py-2 text-foreground">{env.name}</td>
                            <td className="px-3 py-2">
                              <select
                                value={effectivePolicy}
                                onChange={(e) => {
                                  const v = e.target.value as SweepPolicy
                                  void saveEnvelopeSweep(env.id, v, env.sweepCapMultiplier ?? sweepCapMultiplier)
                                }}
                                className="bg-[#0D0D0D] border border-[#333] rounded-md px-2 py-1 text-xs text-foreground"
                                aria-label={`Sweep policy for ${env.name}`}
                              >
                                {(Object.keys(SWEEP_POLICY_LABELS) as SweepPolicy[]).map((p) => (
                                  <option key={p} value={p}>
                                    {SWEEP_POLICY_LABELS[p]}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="ml-2 text-xs text-[#D4AF37] hover:underline"
                                onClick={() => void saveEnvelopeSweep(env.id, "default")}
                              >
                                Use default
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <IrregularIncomeDialog triggerVariant="button" />
          </div>

          <WhySavingsExplainer />
        </div>
      )}

      <AlertDialog open={dismissOpen} onOpenChange={setDismissOpen}>
        <AlertDialogContent className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off Savings tracking?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This hides goals, achievements, and the year-end recap. Stops auto-sweeping leftover envelope balances
              (policy switches to carry forward). Your Savings envelope and ledger keep working — you can turn tracking
              back on anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#333] bg-transparent">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#D4AF37] text-[#0D0D0D] hover:bg-[#D4AF37]/90"
              disabled={dismissSaving}
              onClick={(e) => {
                e.preventDefault()
                void confirmDismiss()
              }}
            >
              {dismissSaving ? "Turning off…" : "Turn off tracking"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
