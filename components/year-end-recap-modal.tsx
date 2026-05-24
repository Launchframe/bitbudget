"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useApp } from "@/lib/app-context"
import { formatUsd } from "@/lib/data"
import { SAVINGS_EXPERIENCE_DISMISSED } from "@/lib/constants"
import { ACHIEVEMENT_LABELS, findSavingsEnvelope, savingsBalance } from "@/lib/savings-ui-metrics"
import {
  aggregateYearEndRecap,
  shouldShowYearEndRecap,
  yearEndRecapStorageKey,
} from "@/lib/year-end-recap"
import type { SavingsGoalRow } from "@/lib/savings-ui-metrics"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Sparkles, Trophy } from "lucide-react"

interface UserAchievement {
  code: string
  earnedAt: string
}

export function YearEndRecapModal() {
  const { state, activeTransactions, discretionaryEnvelopes } = useApp()
  const [open, setOpen] = useState(false)
  const [closedGoals, setClosedGoals] = useState<SavingsGoalRow[]>([])
  const [achievements, setAchievements] = useState<UserAchievement[]>([])

  const recapYear = useMemo(() => shouldShowYearEndRecap().recapYear, [])

  const savingsBal = useMemo(() => {
    return savingsBalance(activeTransactions, findSavingsEnvelope(state.envelopes))
  }, [activeTransactions, state.envelopes])

  const monthlySaveRate = useMemo(() => {
    const inYear = closedGoals.filter((g) => g.periodKey.startsWith(`${recapYear}-`))
    if (inYear.length === 0) return 0
    const sum = inYear.reduce((s, g) => s + (g.actualSavedAmount ?? 0), 0)
    return sum / inYear.length
  }, [closedGoals, recapYear])

  const achievementsInRecapYear = useMemo(
    () =>
      achievements
        .filter((a) => a.earnedAt.startsWith(String(recapYear)))
        .slice(0, 5),
    [achievements, recapYear],
  )

  const stats = useMemo(
    () =>
      aggregateYearEndRecap({
        year: recapYear,
        closedGoals: closedGoals.map((g) => ({
          periodKey: g.periodKey,
          actualSavedAmount: g.actualSavedAmount ?? null,
          achievedGoal: g.achievedGoal ?? null,
          closedAt: g.closedAt ? new Date(g.closedAt) : null,
        })),
        achievementsInYear: achievements.filter((a) => a.earnedAt.startsWith(String(recapYear))).length,
        currentSavingsBalance: savingsBal,
        monthlySaveRate,
      }),
    [recapYear, closedGoals, achievements, savingsBal, monthlySaveRate],
  )

  const loadData = useCallback(async () => {
    const from = `${recapYear}-01`
    const to = `${recapYear}-12`
    const [goalsRes, achRes] = await Promise.all([
      fetch(`/api/user/savings-goals?from=${from}&to=${to}`),
      fetch("/api/user/achievements"),
    ])
    if (goalsRes.ok) {
      const body = (await goalsRes.json()) as { goals?: SavingsGoalRow[] }
      setClosedGoals(body.goals ?? [])
    }
    if (achRes.ok) {
      const body = (await achRes.json()) as { achievements?: UserAchievement[] }
      setAchievements(body.achievements ?? [])
    }
  }, [recapYear])

  useEffect(() => {
    if (state.savingsExperience === SAVINGS_EXPERIENCE_DISMISSED) return
    const { show } = shouldShowYearEndRecap()
    if (!show) return
    const key = yearEndRecapStorageKey(recapYear)
    try {
      if (localStorage.getItem(key) === "1") return
    } catch {
      return
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        await loadData()
        setOpen(true)
      })()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [state.savingsExperience, recapYear, loadData])

  const dismiss = () => {
    try {
      localStorage.setItem(yearEndRecapStorageKey(recapYear), "1")
    } catch {
      /* ignore */
    }
    setOpen(false)
  }

  if (state.savingsExperience === SAVINGS_EXPERIENCE_DISMISSED) return null

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : dismiss())}>
      <DialogContent className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#D4AF37]" aria-hidden />
            Your {recapYear} savings recap
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          A look back at your Savings journey last year
          {discretionaryEnvelopes.length > 0 ? " — envelope discipline included." : "."}
        </p>

        <dl className="grid grid-cols-1 gap-3 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Total saved</dt>
            <dd className="font-semibold text-[#D4AF37]">{formatUsd(stats.totalSaved)}</dd>
          </div>
          {stats.bestMonth && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Best month</dt>
              <dd>{formatUsd(stats.bestMonth.amount)}</dd>
            </div>
          )}
          {stats.worstMonth && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Toughest month</dt>
              <dd>{formatUsd(stats.worstMonth.amount)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Longest streak</dt>
            <dd>{stats.longestStreak} month(s)</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Achievements</dt>
            <dd className="flex items-center gap-1">
              <Trophy className="h-3.5 w-3.5 text-[#D4AF37]" aria-hidden />
              {stats.achievementsEarned}
            </dd>
          </div>
          {stats.projection2030 != null && (
            <div className="rounded-xl border border-[#1F1F1F] bg-[#111] p-3 text-xs text-muted-foreground">
              At your recent pace, you could reach{" "}
              <span className="text-foreground font-medium">{formatUsd(stats.projection2030)}</span> by 2030.
            </div>
          )}
        </dl>

        {achievementsInRecapYear.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Achievements earned last year">
            {achievementsInRecapYear.map((a) => (
              <span
                key={a.code}
                className="text-[10px] px-2 py-0.5 rounded-full bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30"
              >
                {ACHIEVEMENT_LABELS[a.code] ?? a.code}
              </span>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" className="bg-[#D4AF37] text-[#0D0D0D] hover:bg-[#D4AF37]/90" onClick={dismiss}>
            Continue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
