"use client"

import { useEffect, useMemo, useState } from "react"
import { useApp } from "@/lib/app-context"
import { formatUsd, getCurrentMonthKey } from "@/lib/data"
import { useRunway } from "@/lib/use-runway"
import { isRunwayConfigured } from "@/lib/runway-ui"
import {
  avgMonthlySpendLastNMonths,
  findSavingsEnvelope,
  savingsBalance,
  sumMonthlyIncomeCredits,
} from "@/lib/savings-ui-metrics"
import {
  computeGoalImpact,
  computeMonthsLeftImpact,
  formatMonthsLeft,
  isLargeExpense,
  type GoalImpactResult,
} from "@/lib/runway-expense-impact"
import { PlaneTakeoff, Target } from "lucide-react"

interface SavingsGoalLite {
  targetAmount?: number | null
  startBalance?: number | null
}

/** Fraction of the current month elapsed (0..1), by local calendar day. */
function monthProgressNow(): number {
  const now = new Date()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  return daysInMonth > 0 ? now.getDate() / daysInMonth : 0
}

function goalLine(
  base: GoalImpactResult,
  withExpense: GoalImpactResult,
): string | null {
  if (withExpense.status === "out_of_reach") {
    const by = formatUsd(withExpense.outOfReachByUsd)
    return base.status === "out_of_reach"
      ? `This keeps this month's savings goal out of reach by ${by}, even if you spend nothing else.`
      : `This puts this month's savings goal out of reach by ${by}, even if you spend nothing else.`
  }
  if (withExpense.status === "behind_pace") {
    return "You'd be behind this month's savings pace, but a later paycheck could still catch you up."
  }
  return null
}

/**
 * Inline, calm preview of how the in-progress expense affects the user's
 * monthly savings goal and their runway. Only mounted when bitcoin features are
 * on; renders nothing until a runway plan is configured. Uses a reserved
 * min-height so the message toggling never shifts the form.
 *
 * Mounted lazily by the New Transaction dialog (only while open), so the plan /
 * goal fetches it triggers do not run on every page load.
 */
export function ExpenseImpactBand({
  amountUsd,
  envelopeId,
}: {
  amountUsd: number
  envelopeId: string
}) {
  const { state, activeTransactions } = useApp()
  const { plan, loading, compute, btcPriceOrNull } = useRunway({ withLoans: false })

  const monthKey = getCurrentMonthKey()
  const [goal, setGoal] = useState<SavingsGoalLite | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/user/savings-goal?periodKey=${encodeURIComponent(monthKey)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((g: SavingsGoalLite | null) => {
        if (!cancelled) setGoal(g)
      })
      .catch(() => {
        /* optional enrichment */
      })
    return () => {
      cancelled = true
    }
  }, [monthKey])

  const savingsEnvelope = useMemo(
    () => findSavingsEnvelope(state.envelopes),
    [state.envelopes],
  )
  const balance = useMemo(
    () => savingsBalance(activeTransactions, savingsEnvelope),
    [activeTransactions, savingsEnvelope],
  )
  const incomeStillExpectedUsd = useMemo(() => {
    const received = sumMonthlyIncomeCredits(activeTransactions, monthKey)
    return Math.max(0, state.monthlyIncome - received)
  }, [activeTransactions, monthKey, state.monthlyIncome])

  const envelopeUsualMonthlyUsd = useMemo(() => {
    if (!envelopeId) return 0
    return avgMonthlySpendLastNMonths(activeTransactions, new Set([envelopeId]), 3)
  }, [activeTransactions, envelopeId])

  const configured = isRunwayConfigured(plan)
  const validAmount = Number.isFinite(amountUsd) && amountUsd > 0

  // Savings-goal impact (base = no expense, withExpense = this amount).
  const target = Number(goal?.targetAmount ?? 0)
  const keptSoFarUsd = Math.max(0, balance - Number(goal?.startBalance ?? 0))
  const monthProgress = monthProgressNow()
  const goalMsg = useMemo(() => {
    if (!validAmount || target <= 0) return null
    const common = { goalUsd: target, keptSoFarUsd, incomeStillExpectedUsd, monthProgress }
    const base = computeGoalImpact(common)
    const withExpense = computeGoalImpact({ ...common, expenseUsd: amountUsd })
    return goalLine(base, withExpense)
  }, [validAmount, target, keptSoFarUsd, incomeStillExpectedUsd, monthProgress, amountUsd])

  // Runway months-left impact.
  const comp = useMemo(() => (validAmount ? compute("none") : null), [validAmount, compute])
  const monthsImpact = useMemo(() => {
    const need = comp?.need
    if (!need || need.monthlyDrawUsd <= 0) return null
    const draw = need.monthlyDrawUsd
    const liquidTodayUsd = (need.monthsLeft ?? 0) * draw
    const liquidStressUsd = need.monthsLeftAtStress != null ? need.monthsLeftAtStress * draw : null
    const liquidGrowthUsd = need.monthsLeftAtGrowth != null ? need.monthsLeftAtGrowth * draw : null
    const r = computeMonthsLeftImpact({
      liquidTodayUsd,
      monthlyDrawUsd: draw,
      expenseUsd: amountUsd,
      liquidStressUsd,
      liquidGrowthUsd,
    })
    return r.available ? r : null
  }, [comp, amountUsd])

  const priceKnown = btcPriceOrNull != null && btcPriceOrNull > 0
  const showGrowth =
    priceKnown &&
    plan?.growthRateYear != null &&
    isLargeExpense(amountUsd, envelopeUsualMonthlyUsd) &&
    monthsImpact?.monthsBeforeGrowth != null &&
    monthsImpact?.monthsAfterGrowth != null

  // Not configured (or still loading the plan): no band, no reserved space.
  if (loading || !configured) return null

  return (
    <div
      className="min-h-[3.25rem] rounded-xl border border-[#1F1F1F] bg-[#1A1A1A]/40 px-3 py-2.5"
      aria-live="polite"
    >
      {!validAmount ? (
        <p className="text-xs text-muted-foreground">
          We&apos;ll show how this affects your savings goal and your runway as you type an amount.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {goalMsg && (
            <div className="flex items-start gap-2">
              <Target
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#D4AF37]"
                aria-hidden
              />
              <p className="text-xs leading-relaxed text-foreground">{goalMsg}</p>
            </div>
          )}
          {monthsImpact && (
            <div className="flex items-start gap-2">
              <PlaneTakeoff
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#F7931A]"
                aria-hidden
              />
              <div className="min-w-0 text-xs leading-relaxed text-foreground">
                <p>
                  On your runway, this is {formatMonthsLeft(monthsImpact.monthsBefore)} →{" "}
                  {formatMonthsLeft(monthsImpact.monthsAfter)}
                  {monthsImpact.monthsBeforeStress != null &&
                    monthsImpact.monthsAfterStress != null && (
                      <span className="text-muted-foreground">
                        {" "}
                        ({formatMonthsLeft(monthsImpact.monthsBeforeStress)} →{" "}
                        {formatMonthsLeft(monthsImpact.monthsAfterStress)} if bitcoin dips)
                      </span>
                    )}
                  .
                </p>
                {showGrowth && (
                  <p className="text-muted-foreground">
                    If bitcoin keeps growing: {formatMonthsLeft(monthsImpact.monthsBeforeGrowth)} →{" "}
                    {formatMonthsLeft(monthsImpact.monthsAfterGrowth)}.
                  </p>
                )}
                <SeeOnPlanButton amountUsd={amountUsd} />
              </div>
            </div>
          )}
          {!goalMsg && !monthsImpact && (
            <p className="text-xs text-muted-foreground">
              This fits comfortably within your savings goal and your runway.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function SeeOnPlanButton({ amountUsd }: { amountUsd: number }) {
  const { navigateTo, setRunwayWhatIf, setTransactionDialogOpen } = useApp()
  return (
    <button
      type="button"
      className="mt-0.5 text-xs font-medium text-[#F7931A] underline decoration-[#F7931A]/50 hover:decoration-[#F7931A]"
      onClick={() => {
        setRunwayWhatIf(amountUsd)
        setTransactionDialogOpen(false)
        navigateTo("runway")
      }}
    >
      See this on your plan
    </button>
  )
}
