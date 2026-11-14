"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useApp } from "@/lib/app-context"
import { formatUsd, getCurrentMonthKey } from "@/lib/data"
import {
  SAVINGS_EXPERIENCE_DISMISSED,
  SAVINGS_GOLD_ACCENT,
} from "@/lib/constants"
import {
  ACHIEVEMENT_LABELS,
  avgMonthlySpendLastNMonths,
  bestMonthFromGoals,
  computeGoalStreak,
  daysOfIndependence,
  findSavingsEnvelope,
  formatPeriodKeyLabel,
  savingsBalance,
  sumEnvelopeSweepCreditsYear,
  type SavingsGoalRow,
} from "@/lib/savings-ui-metrics"
import {
  formatSavingsSinceLabel,
  resolveSavingsTrackingStartFromTransactions,
  savingsBalanceSince,
} from "@/lib/savings-display"
import { IrregularIncomeDialog } from "@/components/irregular-income-dialog"
import { SavingsGoalsWalkthroughDialog } from "@/components/savings-goals-walkthrough-dialog"
import { EnvelopeSweepDialog } from "@/components/envelope-sweep-dialog"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Input } from "@/components/ui/input"
import { GoalProgressRing } from "@/components/goal-progress-ring"
import {
  ArrowRight,
  Flame,
  PiggyBank,
  Sparkles,
  Target,
  Trophy,
} from "lucide-react"

interface UserAchievement {
  code: string
  earnedAt: string
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const max = Math.max(...values, 1)
  const w = 120
  const h = 32
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - (v / max) * h
      return `${x},${y}`
    })
    .join(" ")

  return (
    <svg width={w} height={h} className="text-[#D4AF37]" aria-hidden>
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  )
}

export function SavingsHeroCard() {
  const {
    state,
    activeTransactions,
    discretionaryEnvelopes,
    navigateTo,
    refreshData,
    accountCreatedAtIso,
    onboardingCompletedAtIso,
  } = useApp()
  const [currentGoal, setCurrentGoal] = useState<SavingsGoalRow | null>(null)
  const [closedGoals, setClosedGoals] = useState<SavingsGoalRow[]>([])
  const [achievements, setAchievements] = useState<UserAchievement[]>([])
  const [sweepOpen, setSweepOpen] = useState(false)
  const [goalOpen, setGoalOpen] = useState(false)
  const [walkthroughOpen, setWalkthroughOpen] = useState(false)
  const [goalAmount, setGoalAmount] = useState(0)
  const [goalSaving, setGoalSaving] = useState(false)
  const [goalError, setGoalError] = useState<string | null>(null)
  const [sweepToast, setSweepToast] = useState<number | null>(null)

  const savingsEnvelope = findSavingsEnvelope(state.envelopes)
  const monthKey = getCurrentMonthKey()
  const savingsSinceStart = resolveSavingsTrackingStartFromTransactions(
    activeTransactions,
    onboardingCompletedAtIso,
    accountCreatedAtIso,
  )
  const balance =
    savingsSinceStart != null
      ? savingsBalanceSince(activeTransactions, savingsEnvelope, savingsSinceStart)
      : savingsBalance(activeTransactions, savingsEnvelope)
  const sinceLabel = savingsSinceStart ? formatSavingsSinceLabel(savingsSinceStart) : null
  const engaged = state.savingsExperience !== SAVINGS_EXPERIENCE_DISMISSED

  const discretionaryIds = useMemo(
    () => new Set(discretionaryEnvelopes.map((e) => e.id)),
    [discretionaryEnvelopes],
  )

  const loadGoalData = useCallback(async () => {
    const year = monthKey.slice(0, 4)
    const fromMonth = `${Number(year) - 1}-${monthKey.slice(5)}`
    try {
      const [goalRes, listRes, achRes] = await Promise.all([
        fetch(`/api/user/savings-goal?periodKey=${encodeURIComponent(monthKey)}`),
        fetch(`/api/user/savings-goals?from=${encodeURIComponent(fromMonth)}&to=${encodeURIComponent(monthKey)}`),
        fetch("/api/user/achievements?limit=3"),
      ])
      if (goalRes.ok) {
        const g = (await goalRes.json()) as SavingsGoalRow
        setCurrentGoal(g)
        setGoalAmount(g.targetAmount ?? 0)
      }
      if (listRes.ok) {
        const list = (await listRes.json()) as { goals?: SavingsGoalRow[] }
        setClosedGoals((list.goals ?? []).filter((g) => g.closedAt))
      }
      if (achRes.ok) {
        const ach = (await achRes.json()) as { achievements?: UserAchievement[] }
        setAchievements(ach.achievements ?? [])
      }
    } catch {
      /* optional API enrichment */
    }
  }, [monthKey])

  useEffect(() => {
    if (engaged) void loadGoalData()
  }, [engaged, loadGoalData])

  const startBal = currentGoal?.startBalance ?? 0
  const target = currentGoal?.targetAmount ?? 0
  const savedThisMonth = Math.max(0, balance - startBal)
  const liveProgress = target > 0 ? savedThisMonth / target : 0

  const streak = computeGoalStreak(closedGoals)
  const bestMonth = bestMonthFromGoals(closedGoals)
  const bestStreak = useMemo(() => {
    let max = 0
    let run = 0
    const sorted = [...closedGoals]
      .filter((g) => g.closedAt)
      .sort((a, b) => a.periodKey.localeCompare(b.periodKey))
    for (const row of sorted) {
      if (row.achievedGoal) {
        run++
        max = Math.max(max, run)
      } else {
        run = 0
      }
    }
    return max
  }, [closedGoals])

  const yearSavedTotal = useMemo(() => {
    const year = monthKey.slice(0, 4)
    return closedGoals
      .filter((g) => g.periodKey.startsWith(year) && g.actualSavedAmount != null)
      .reduce((s, g) => s + (g.actualSavedAmount ?? 0), 0)
  }, [closedGoals, monthKey])

  const sparklineValues = useMemo(() => {
    const keys: string[] = []
    const d = new Date()
    for (let i = 5; i >= 0; i--) {
      const dt = new Date(d.getFullYear(), d.getMonth() - i, 1)
      keys.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`)
    }
    return keys.map((k) => {
      const row = closedGoals.find((g) => g.periodKey === k)
      if (row?.actualSavedAmount != null) return row.actualSavedAmount
      if (k === monthKey) return savedThisMonth
      return 0
    })
  }, [closedGoals, monthKey, savedThisMonth])

  const avgSpend = avgMonthlySpendLastNMonths(activeTransactions, discretionaryIds, 3)
  const independenceDays = daysOfIndependence(balance, avgSpend)
  const yearSweepTotal = savingsEnvelope
    ? sumEnvelopeSweepCreditsYear(activeTransactions, savingsEnvelope.id, monthKey.slice(0, 4))
    : 0

  const saveGoal = async () => {
    setGoalError(null)
    setGoalSaving(true)
    try {
      const res = await fetch("/api/user/savings-goal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodKey: monthKey, targetAmount: goalAmount }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setGoalError(typeof body.error === "string" ? body.error : "Could not save goal.")
        return
      }
      setCurrentGoal(body as SavingsGoalRow)
      setGoalOpen(false)
      await refreshData()
    } catch {
      setGoalError("Network error — try again.")
    } finally {
      setGoalSaving(false)
    }
  }

  if (!savingsEnvelope) return null

  if (!engaged) {
    return (
      <div className="flex items-center justify-between gap-4 p-4 md:p-5 bg-[#0D0D0D] rounded-2xl border border-[#1F1F1F]">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Savings</span>
          <span className="text-2xl font-bold text-foreground">{formatUsd(balance)}</span>
          {sinceLabel && (
            <span className="text-xs text-muted-foreground">Saved since {sinceLabel}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => navigateTo("envelope-detail", savingsEnvelope.id)}
          className="text-sm text-[#D4AF37] hover:underline flex items-center gap-1"
        >
          View Savings transactions
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  const editability = currentGoal?.editability ?? "editable"
  const streakIconClass =
    streak >= 12 ? "text-[#D4AF37]" : streak >= 6 ? "text-orange-400" : streak >= 3 ? "text-amber-400" : "text-muted-foreground"

  return (
    <>
      <div
        className="flex flex-col gap-5 p-4 md:p-6 bg-[#0D0D0D] rounded-2xl border lg:w-2/3"
        style={{ borderColor: `${SAVINGS_GOLD_ACCENT}55` }}
      >
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <PiggyBank className="h-4 w-4" style={{ color: SAVINGS_GOLD_ACCENT }} aria-hidden />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Savings</span>
            </div>
            <span className="text-3xl md:text-4xl font-bold text-foreground">{formatUsd(balance)}</span>
            {sinceLabel && (
              <span className="text-xs text-muted-foreground">Saved since {sinceLabel}</span>
            )}
            {independenceDays > 0 && (
              <span className="text-xs text-muted-foreground">
                {independenceDays} day{independenceDays !== 1 ? "s" : ""} of expenses covered
              </span>
            )}
          </div>

          <div className="flex items-center gap-4">
            <GoalProgressRing progress={liveProgress} />
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Monthly goal</span>
              <span className="font-semibold text-foreground">{formatUsd(target)}</span>
              <span className="text-xs text-muted-foreground">{formatUsd(savedThisMonth)} saved this month</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {streak > 0 && (
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-[#1A1A1A] ${streakIconClass}`}>
              <Flame className="h-3.5 w-3.5" aria-hidden />
              {streak} month{streak !== 1 ? "s" : ""} hitting goal
            </span>
          )}
          <Sparkline values={sparklineValues} />
        </div>

        <p className="text-xs text-muted-foreground">
          {bestMonth ? (
            <>
              Best month: {formatUsd(bestMonth.amount)} ({formatPeriodKeyLabel(bestMonth.periodKey)})
              {bestStreak > 0 && <> · Best streak: {bestStreak}</>}
              {yearSavedTotal > 0 && <> · Total saved this year: {formatUsd(yearSavedTotal)}</>}
            </>
          ) : (
            <>Set a monthly goal to start tracking your savings streak.</>
          )}
        </p>

        {yearSweepTotal > 0 && (
          <p className="text-xs text-[#D4AF37]/90">
            Swept {formatUsd(yearSweepTotal)} into Savings this year
          </p>
        )}

        {achievements.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Recent achievements">
            {achievements.slice(0, 3).map((a) => (
              <span
                key={a.code}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/25"
              >
                <Trophy className="h-3 w-3" aria-hidden />
                {ACHIEVEMENT_LABELS[a.code] ?? a.code}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <IrregularIncomeDialog />
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-walkthrough="sweep-cta"
            className="border-[#333] hover:border-[#D4AF37]/50"
            onClick={() => setSweepOpen(true)}
          >
            <Sparkles className="h-3.5 w-3.5 mr-1.5" aria-hidden />
            Sweep to Savings
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-[#333] hover:border-[#D4AF37]/50"
            onClick={() => setWalkthroughOpen(true)}
          >
            How it works
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-[#333]"
            onClick={() => {
              setGoalAmount(target)
              setGoalOpen(true)
            }}
          >
            <Target className="h-3.5 w-3.5 mr-1.5" aria-hidden />
            Set goal
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-[#333]"
            onClick={() => navigateTo("envelope-detail", savingsEnvelope.id)}
          >
            View details
          </Button>
        </div>
      </div>

      <SavingsGoalsWalkthroughDialog open={walkthroughOpen} onOpenChange={setWalkthroughOpen} />

      <EnvelopeSweepDialog
        open={sweepOpen}
        onOpenChange={setSweepOpen}
        onSuccess={(total) => {
          setSweepToast(total)
          setTimeout(() => setSweepToast(null), 4000)
        }}
      />

      {sweepToast != null && (
        <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-3 bg-[#1A1A1A] border border-[#D4AF37]/40 rounded-xl shadow-xl text-sm text-foreground">
          Swept {formatUsd(sweepToast, 2)} to Savings
        </div>
      )}

      <Dialog open={goalOpen} onOpenChange={setGoalOpen}>
        <DialogContent className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground max-w-sm">
          <DialogHeader>
            <DialogTitle>Set savings goal</DialogTitle>
          </DialogHeader>
          {editability === "closed" ? (
            <p className="text-sm text-muted-foreground">This month&apos;s goal is closed and read-only.</p>
          ) : (
            <>
              {editability === "upward_only" && (
                <p className="text-xs text-amber-400/90">
                  You can only raise this goal — the grace period has ended.
                </p>
              )}
              {bestMonth && editability === "editable" && (
                <button
                  type="button"
                  className="text-xs text-[#D4AF37] hover:underline text-left"
                  onClick={() => setGoalAmount(bestMonth.amount)}
                >
                  Match your best month: {formatUsd(bestMonth.amount)} ({formatPeriodKeyLabel(bestMonth.periodKey)})
                </button>
              )}
              <div className="flex flex-col gap-3 pt-2">
                <Slider
                  min={0}
                  max={Math.max(5000, goalAmount, target, bestMonth?.amount ?? 0) * 1.2}
                  step={25}
                  value={[goalAmount]}
                  onValueChange={(v) => setGoalAmount(v[0] ?? 0)}
                />
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">$</span>
                  <Input
                    type="number"
                    min={0}
                    step={25}
                    value={goalAmount}
                    onChange={(e) => setGoalAmount(parseFloat(e.target.value) || 0)}
                    className="bg-[#1A1A1A] border-[#333]"
                  />
                </div>
              </div>
              {goalError && (
                <p className="text-sm text-amber-400/95" role="alert">
                  {goalError}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setGoalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="bg-[#D4AF37] text-[#0D0D0D] hover:bg-[#D4AF37]/90"
                  disabled={goalSaving || (editability === "upward_only" && goalAmount <= target)}
                  onClick={() => void saveGoal()}
                >
                  {goalSaving ? "Saving…" : "Save goal"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
