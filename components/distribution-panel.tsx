"use client"

import { useEffect, useMemo, useState } from "react"
import { useApp } from "@/lib/app-context"
import { envelopeGenesisFloor, getCurrentMonthKey, getEnvelopeBalance, getEnvelopeBalanceAllTime } from "@/lib/data"
import { findSavingsEnvelope, savingsBalance } from "@/lib/savings-ui-metrics"
import {
  AllocationStackedBar,
  type AllocationBarSegment,
} from "@/components/allocation-stacked-bar"
import { EnvelopeFundSliders } from "@/components/envelope-fund-sliders"
import { SavingsDrawdownSummary } from "@/components/savings-drawdown-summary"
import { FillEnvelopesDialog, behaviorLabel, type FillEnvelopePreviewRow } from "@/components/fill-envelopes-dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { DistributionBehavior, DistributionInvalidReason } from "@/lib/rebalance-math"
import {
  computeDistribution,
  fundablePreviewRows,
  fundedAmountByEnvelopeId,
  requestedPreviewRows,
} from "@/lib/rebalance-math"
import { incomeDistributionConfigFromPanel } from "@/lib/recurring-funding-config"
import { nextRunFromFrequency } from "@/lib/recurring-funding-schedule"
import { cn } from "@/lib/utils"

function distributionErrorMessage(
  reason: DistributionInvalidReason | null,
  savingsBal: number,
  fundOverage: boolean,
): string {
  switch (reason) {
    case "no_income":
      return "Enter an income amount to distribute."
    case "insufficient_income":
      if (savingsBal <= 0 && !fundOverage) {
        return "This fill needs more than your income amount. Choose a smaller option or add money to Savings first."
      }
      if (!fundOverage) {
        return "This fill needs more than the income amount. Turn on “Fund any overage from Savings” or choose a smaller option."
      }
      return "This fill needs more than the income amount. Choose a smaller option."
    case "insufficient_savings":
      return "Not enough in Savings to cover the rest of this distribution."
    case "no_split_targets":
      return "Add a monthly amount to at least one spending envelope to split this deposit."
    default:
      return "This distribution cannot be funded with the current amounts."
  }
}

const BEHAVIOR_OPTIONS: { value: DistributionBehavior; label: string }[] = [
  { value: "set_to_budget", label: "Set to budget amount" },
  { value: "add_budget", label: "Add full budget amount" },
  { value: "split_income_proportional", label: "Split by budget size" },
  { value: "custom", label: "Choose amounts" },
]

export interface DistributionPanelConfig {
  distributionBehavior: DistributionBehavior
  fundOverageFromSavings: boolean
  distributionInvalid: boolean
  invalidReason: DistributionInvalidReason | null
  previewRows: FillEnvelopePreviewRow[]
  fundableRows: FillEnvelopePreviewRow[]
  requestedRows: FillEnvelopePreviewRow[]
  customByEnvelopeId?: Record<string, number>
  /** Total USD this distribution draws from Savings (overage). For confirm UI. */
  fromSavingsUsd: number
}

export function DistributionPanel({
  grossUsd,
  sourceFunding,
  onConfigChange,
}: {
  grossUsd: number
  sourceFunding: "income" | "savings"
  onConfigChange: (config: DistributionPanelConfig) => void
}) {
  const { discretionaryEnvelopes, activeEnvelopes, activeTransactions } = useApp()
  const monthKey = getCurrentMonthKey()
  const savingsEnv = findSavingsEnvelope(activeEnvelopes)
  const savingsBal = savingsBalance(activeTransactions, savingsEnv)

  const [behavior, setBehavior] = useState<DistributionBehavior>("set_to_budget")
  const [fundOverage, setFundOverage] = useState(false)
  const [customByEnvelopeId, setCustomByEnvelopeId] = useState<Record<string, number>>({})
  const [manuallySetEnvelopes, setManuallySetEnvelopes] = useState<Set<string>>(() => new Set())
  const [fillOpen, setFillOpen] = useState(false)
  const [fillExpanded, setFillExpanded] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleFrequency, setScheduleFrequency] = useState("monthly")
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null)

  const preview = useMemo(() => {
    // Use all-time (remaining) balance so set_to_budget correctly computes gap = allotment − remaining.
    // Month-scoped balance is negative for carry-forward envelopes after mid-month spending,
    // which overstates the gap and causes the income to be over-drained into envelopes.
    const envelopes = discretionaryEnvelopes.map((e) => ({
      id: e.id,
      monthlyAllotment: e.monthlyAllotment,
      currentMonthBalance: getEnvelopeBalanceAllTime(
        activeTransactions,
        e.id,
        e.createdAt ? envelopeGenesisFloor(e.createdAt) : undefined,
      ),
    }))
    const customMap =
      behavior === "custom" ? new Map(Object.entries(customByEnvelopeId)) : undefined
    const dist = computeDistribution({
      behavior,
      envelopes,
      grossUsd: sourceFunding === "income" ? grossUsd : 0,
      savingsBalance: savingsBal,
      fundOverageFromSavings: fundOverage,
      customByEnvelopeId: customMap,
    })
    const label = behaviorLabel(behavior)
    const fundableRows = fundablePreviewRows(dist, label)
    const requestedRows = requestedPreviewRows(dist, label)
    return { dist, fundableRows, requestedRows }
  }, [
    behavior,
    fundOverage,
    grossUsd,
    sourceFunding,
    savingsBal,
    discretionaryEnvelopes,
    activeTransactions,
    customByEnvelopeId,
  ])

  const distributionByBehaviorOption = useMemo(() => {
    const envelopes = discretionaryEnvelopes.map((e) => ({
      id: e.id,
      monthlyAllotment: e.monthlyAllotment,
      currentMonthBalance: getEnvelopeBalanceAllTime(
        activeTransactions,
        e.id,
        e.createdAt ? envelopeGenesisFloor(e.createdAt) : undefined,
      ),
    }))
    const gross = sourceFunding === "income" ? grossUsd : 0
    const customMap = new Map(
      Object.entries(customByEnvelopeId).filter(([, v]) => Number.isFinite(v) && v > 0.005),
    )
    const mk = (b: DistributionBehavior) =>
      computeDistribution({
        behavior: b,
        envelopes,
        grossUsd: gross,
        savingsBalance: savingsBal,
        fundOverageFromSavings: fundOverage,
        customByEnvelopeId: b === "custom" ? customMap : undefined,
      })
    return {
      set_to_budget: mk("set_to_budget"),
      add_budget: mk("add_budget"),
      split_income_proportional: mk("split_income_proportional"),
      custom: mk("custom"),
    }
  }, [
    discretionaryEnvelopes,
    activeTransactions,
    grossUsd,
    sourceFunding,
    savingsBal,
    fundOverage,
    customByEnvelopeId,
  ])

  const fundedMap = useMemo(
    () => fundedAmountByEnvelopeId(preview.dist),
    [preview.dist],
  )

  useEffect(() => {
    const customPayload =
      behavior === "custom"
        ? Object.fromEntries(
            Object.entries(customByEnvelopeId).filter(([, v]) => Number.isFinite(v) && v > 0.005),
          )
        : undefined
    onConfigChange({
      distributionBehavior: behavior,
      fundOverageFromSavings: fundOverage,
      distributionInvalid: preview.dist.invalid,
      invalidReason: preview.dist.invalidReason,
      previewRows: preview.fundableRows,
      fundableRows: preview.fundableRows,
      requestedRows: preview.requestedRows,
      customByEnvelopeId: customPayload,
      fromSavingsUsd: preview.dist.fromSavings,
    })
  }, [behavior, fundOverage, preview, customByEnvelopeId, onConfigChange])

  const barSegments: AllocationBarSegment[] = useMemo(() => {
    return discretionaryEnvelopes.map((env) => {
      const current = getEnvelopeBalance(activeTransactions, env.id, monthKey)
      const funded = fundedMap.get(env.id) ?? 0
      const requested = preview.requestedRows.find((r) => r.envelopeId === env.id)?.deltaUsd ?? 0
      const add = preview.dist.invalid ? funded : requested
      return {
        id: env.id,
        name: env.name,
        color: env.color,
        icon: env.icon,
        value: current + add,
      }
    })
  }, [
    discretionaryEnvelopes,
    activeTransactions,
    monthKey,
    fundedMap,
    preview.dist.invalid,
    preview.requestedRows,
  ])

  const fundedTotal = preview.fundableRows.reduce((s, r) => s + r.deltaUsd, 0)
  const poolTotal =
    (sourceFunding === "income" ? grossUsd : 0) +
    barSegments.reduce((s, x) => s + x.value, 0)

  const previewCount = preview.requestedRows.length

  function handleCustomChange(envelopeId: string, amountUsd: number) {
    setCustomByEnvelopeId((prev) => ({ ...prev, [envelopeId]: amountUsd }))
  }

  function handleBehaviorChange(next: DistributionBehavior) {
    setBehavior(next)
    if (next !== "custom") {
      setCustomByEnvelopeId({})
      setManuallySetEnvelopes(new Set())
    }
    if (next === "custom" && sourceFunding === "income") {
      setFillExpanded(true)
    }
  }

  async function saveSchedule() {
    if (preview.dist.invalid || preview.fundableRows.length === 0) {
      setScheduleMessage("Fix the distribution above before saving a schedule.")
      return
    }
    setScheduleSaving(true)
    setScheduleMessage(null)
    try {
      const distributionConfig = incomeDistributionConfigFromPanel({
        distributionBehavior: behavior,
        fundOverageFromSavings: fundOverage,
        grossUsd: sourceFunding === "income" ? grossUsd : 0,
        customByEnvelopeId:
          behavior === "custom"
            ? Object.fromEntries(
                Object.entries(customByEnvelopeId).filter(([, v]) => v > 0.005),
              )
            : undefined,
      })
      const res = await fetch("/api/recurring-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "income_distribution",
          frequency: scheduleFrequency,
          distributionConfig,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { rule?: { nextRunAt?: string }; error?: string }
      if (!res.ok) {
        setScheduleMessage(typeof data.error === "string" ? data.error : "Could not save schedule.")
        return
      }
      const nextLabel = data.rule?.nextRunAt
        ? new Date(data.rule.nextRunAt).toLocaleDateString()
        : new Date(nextRunFromFrequency(scheduleFrequency, new Date())).toLocaleDateString()
      setScheduleMessage(`Saved. Next automatic run: ${nextLabel}. Manage rules under Settings → Budgeting rules.`)
    } catch {
      setScheduleMessage("Network error — try again.")
    } finally {
      setScheduleSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-[#333] p-4 bg-[#0D0D0D]/50 min-w-0">
      <AllocationStackedBar
        envelopes={barSegments}
        savingsValue={
          sourceFunding === "income"
            ? Math.max(0, grossUsd - fundedTotal)
            : savingsBal
        }
        totalValue={poolTotal > 0 ? poolTotal : 1}
      />

      <div className="flex flex-col gap-2 min-w-0">
        <span className="text-sm font-medium">How should envelopes be filled?</span>
        <div
          className="flex flex-col gap-1 p-1 rounded-xl bg-[#111] border border-[#1F1F1F] sm:flex-row"
          role="group"
          aria-label="Fill option"
        >
          {BEHAVIOR_OPTIONS.map(({ value, label }) => {
            const selected = behavior === value
            const optDist = distributionByBehaviorOption[value]
            const cannotSwitch = value !== "custom" && optDist.invalid && !selected
            const tip =
              cannotSwitch && optDist.invalidReason
                ? distributionErrorMessage(optDist.invalidReason, savingsBal, fundOverage)
                : null
            const buttonEl = (
              <button
                type="button"
                disabled={cannotSwitch}
                className={cn(
                  "w-full py-2 px-2 text-xs sm:text-sm rounded-lg transition-colors text-center min-w-0",
                  selected
                    ? "bg-[#F7931A] text-[#0D0D0D] font-medium"
                    : cannotSwitch
                      ? "text-muted-foreground/50 cursor-not-allowed border border-transparent"
                      : "text-muted-foreground hover:text-foreground border border-transparent",
                )}
                aria-pressed={selected}
                onClick={() => handleBehaviorChange(value)}
              >
                {label}
              </button>
            )
            return (
              <div key={value} className="flex flex-1 min-w-0">
                {cannotSwitch && tip ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex w-full min-w-0">{buttonEl}</span>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      sideOffset={6}
                      className="max-w-[min(96vw,18rem)] border border-[#333] bg-[#1A1A1A] px-3 py-2 text-xs text-muted-foreground shadow-xl [&>svg]:hidden"
                    >
                      {tip}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  buttonEl
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          behavior === "custom" && sourceFunding === "income" && fillExpanded
            ? "grid-rows-[1fr]"
            : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden min-h-0">
          {behavior === "custom" && sourceFunding === "income" ? (
            <EnvelopeFundSliders
              mode="income"
              grossUsd={grossUsd}
              valuesByEnvelopeId={customByEnvelopeId}
              manuallySetEnvelopes={manuallySetEnvelopes}
              onChange={handleCustomChange}
              onManualTouch={(id) => setManuallySetEnvelopes((prev) => new Set(prev).add(id))}
            />
          ) : null}
        </div>
      </div>

      {behavior === "custom" && sourceFunding === "income" && !fillExpanded ? (
        <button
          type="button"
          className="text-sm text-[#3B82F6] hover:underline text-left"
          onClick={() => setFillExpanded(true)}
        >
          Fill envelopes now
        </button>
      ) : null}

      {sourceFunding === "income" ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="fund-overage" className="text-sm text-muted-foreground">
              Fund any overage from Savings
            </Label>
            <Switch
              id="fund-overage"
              checked={fundOverage}
              onCheckedChange={setFundOverage}
              disabled={savingsBal <= 0}
            />
          </div>
          {savingsBal <= 0 ? (
            <p className="text-xs text-muted-foreground">
              Add money to Savings first to cover fills larger than this income amount.
            </p>
          ) : null}
        </div>
      ) : null}

      {sourceFunding === "income" && Number.isFinite(grossUsd) && grossUsd > 0.005 ? (
        <SavingsDrawdownSummary drawFromSavingsUsd={preview.dist.fromSavings} savingsBalanceUsd={savingsBal} />
      ) : null}

      {preview.dist.invalid ? (
        <p className="text-sm text-destructive" role="alert">
          {distributionErrorMessage(preview.dist.invalidReason, savingsBal, fundOverage)}
        </p>
      ) : null}

      {sourceFunding === "savings" ? (
        <div className="min-h-6 flex items-center">
          <button
            type="button"
            className="text-sm text-[#3B82F6] hover:underline text-left"
            onClick={() => setFillOpen(true)}
          >
            {previewCount > 0
              ? `View ${previewCount} affected envelope${previewCount === 1 ? "" : "s"} →`
              : "View envelopes (none selected yet) →"}
          </button>
        </div>
      ) : preview.requestedRows.length > 0 ? (
        <button
          type="button"
          className="text-sm text-[#3B82F6] hover:underline text-left"
          onClick={() => setFillOpen(true)}
        >
          View {preview.requestedRows.length} affected envelope
          {preview.requestedRows.length === 1 ? "" : "s"} →
        </button>
      ) : (
        <p className="text-sm text-muted-foreground">No envelope top-ups needed with this option.</p>
      )}

      <FillEnvelopesDialog
        open={fillOpen}
        onOpenChange={setFillOpen}
        rows={preview.requestedRows}
        fundedRows={preview.fundableRows}
        grossUsd={grossUsd}
        readOnly
        distributionInvalid={preview.dist.invalid}
        invalidReason={preview.dist.invalidReason}
        savingsDrawForSummaryUsd={preview.dist.fromSavings}
        savingsBalanceForSummaryUsd={savingsBal}
      />

      <div className="border-t border-[#333] pt-3">
        <button
          type="button"
          className="text-sm font-medium text-foreground"
          onClick={() => setScheduleOpen((o) => !o)}
        >
          {scheduleOpen ? "Hide schedule" : "Schedule this"}
        </button>
        {scheduleOpen ? (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              Save this fill option to run automatically on a schedule (daily envelope-funding cron).
              Amounts are recalculated each run from your current envelope balances.
            </p>
            <label className="text-xs text-muted-foreground">
              Frequency
              <select
                className="mt-1 w-full rounded-lg border border-[#333] bg-[#1A1A1A] px-2 py-2 text-sm"
                value={scheduleFrequency}
                onChange={(e) => setScheduleFrequency(e.target.value)}
              >
                <option value="weekly">Weekly</option>
                <option value="bimonthly">Twice a month</option>
                <option value="monthly">Monthly</option>
                <option value="every_2mo">Every 2 months</option>
                <option value="every_3mo">Every 3 months</option>
                <option value="every_6mo">Every 6 months</option>
                <option value="annually">Annually</option>
              </select>
            </label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={scheduleSaving || preview.dist.invalid}
              onClick={() => void saveSchedule()}
            >
              {scheduleSaving ? "Saving…" : "Save schedule"}
            </Button>
            {scheduleMessage ? (
              <p
                className={`text-xs ${scheduleMessage.startsWith("Saved") ? "text-success" : "text-muted-foreground"}`}
              >
                {scheduleMessage}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
