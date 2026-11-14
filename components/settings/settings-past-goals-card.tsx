"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Trophy } from "lucide-react"
import { useApp } from "@/lib/app-context"
import { getCurrentMonthKey } from "@/lib/data"
import { GoalProgressRing } from "@/components/goal-progress-ring"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  ACHIEVEMENT_LABELS,
  findSavingsEnvelope,
  formatPeriodKeyLabel,
  savingsBalance,
  type SavingsGoalRow,
} from "@/lib/savings-ui-metrics"
import {
  achievementEarnedInMonth,
  buildPastGoalsMonthRange,
  shiftPeriodKey,
} from "@/lib/past-goals-month-nav"
import { SAVINGS_GOLD_ACCENT } from "@/lib/constants"

type Achievement = { code: string; earnedAt: string }

const ACHIEVEMENT_HINTS: Record<string, string> = {
  goal_hit: "You hit your monthly savings goal.",
  over_saver: "You saved more than your goal for the month.",
  streak_3: "Three months in a row hitting your goal.",
  streak_6: "Six months in a row hitting your goal.",
  streak_12: "Twelve months in a row hitting your goal.",
}

function formatAchievementDate(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ""
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

export function SettingsPastGoalsCard() {
  const { state, activeTransactions } = useApp()
  const monthKey = getCurrentMonthKey()
  const savingsEnvelope = findSavingsEnvelope(state.envelopes)
  const balance = savingsBalance(activeTransactions, savingsEnvelope)

  const [goals, setGoals] = useState<SavingsGoalRow[]>([])
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [loading, setLoading] = useState(true)
  const [monthIndex, setMonthIndex] = useState(0)
  const touchStartX = useRef<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const from = shiftPeriodKey(monthKey, -60)
      const [listRes, achRes] = await Promise.all([
        fetch(`/api/user/savings-goals?from=${encodeURIComponent(from)}&to=${encodeURIComponent(monthKey)}`),
        fetch("/api/user/achievements"),
      ])
      if (listRes.ok) {
        const list = (await listRes.json()) as { goals?: SavingsGoalRow[] }
        setGoals(list.goals ?? [])
      }
      if (achRes.ok) {
        const ach = (await achRes.json()) as { achievements?: Achievement[] }
        setAchievements(ach.achievements ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [monthKey])

  useEffect(() => {
    void load()
  }, [load])

  const monthRange = useMemo(() => buildPastGoalsMonthRange(goals, monthKey), [goals, monthKey])

  useEffect(() => {
    setMonthIndex(Math.max(0, monthRange.length - 1))
  }, [monthRange.length])

  const periodKey = monthRange[monthIndex] ?? monthKey
  const goalRow = goals.find((g) => g.periodKey === periodKey)
  const isCurrentMonth = periodKey === monthKey

  const progress = useMemo(() => {
    if (goalRow?.closedAt && goalRow.progressPct != null) {
      return goalRow.progressPct
    }
    if (isCurrentMonth) {
      const startBal = goalRow?.startBalance ?? 0
      const target = goalRow?.targetAmount ?? 0
      const saved = Math.max(0, balance - startBal)
      return target > 0 ? saved / target : 0
    }
    if (goalRow?.progressPct != null) return goalRow.progressPct
    return 0
  }, [goalRow, isCurrentMonth, balance])

  const monthAchievements = useMemo(
    () => achievements.filter((a) => achievementEarnedInMonth(a.earnedAt, periodKey)),
    [achievements, periodKey],
  )

  const canPrev = monthIndex > 0
  const canNext = monthIndex < monthRange.length - 1

  return (
    <div className="p-6 bg-[#0D0D0D] rounded-2xl min-w-0 w-full max-w-full">
      <h3 className="text-lg font-semibold text-foreground mb-1">Past goals</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Review how you did each month and trophies you earned along the way.
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center" role="status">
          Loading…
        </p>
      ) : monthRange.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Set a savings goal to start tracking monthly progress.
        </p>
      ) : (
        <div
          className="rounded-xl border border-[#1F1F1F] bg-[#1A1A1A] p-4"
          onTouchStart={(e) => {
            touchStartX.current = e.touches[0]?.clientX ?? null
          }}
          onTouchEnd={(e) => {
            const start = touchStartX.current
            touchStartX.current = null
            if (start == null) return
            const end = e.changedTouches[0]?.clientX ?? start
            const delta = end - start
            if (delta > 48 && canPrev) setMonthIndex((i) => i - 1)
            if (delta < -48 && canNext) setMonthIndex((i) => i + 1)
          }}
        >
          <div className="flex items-center justify-between gap-2 mb-4">
            <button
              type="button"
              disabled={!canPrev}
              onClick={() => setMonthIndex((i) => i - 1)}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[#222] disabled:opacity-30 transition-colors"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
            <p className="text-sm font-medium text-foreground text-center min-w-0 truncate">
              {formatPeriodKeyLabel(periodKey)}
              {isCurrentMonth && (
                <span className="text-xs text-muted-foreground font-normal"> · current</span>
              )}
            </p>
            <button
              type="button"
              disabled={!canNext}
              onClick={() => setMonthIndex((i) => i + 1)}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[#222] disabled:opacity-30 transition-colors"
              aria-label="Next month"
            >
              <ChevronRight className="h-5 w-5" aria-hidden />
            </button>
          </div>

          {monthAchievements.length > 0 && (
            <TooltipProvider delayDuration={200}>
              <div className="flex flex-wrap justify-center gap-2 mb-4">
                {monthAchievements.map((a) => (
                  <Tooltip key={`${a.code}-${a.earnedAt}`}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="p-2 rounded-full bg-[#0D0D0D] border border-[#333] hover:border-[#D4AF37]/50 transition-colors"
                        aria-label={ACHIEVEMENT_LABELS[a.code] ?? a.code}
                      >
                        <Trophy className="h-5 w-5" style={{ color: SAVINGS_GOLD_ACCENT }} aria-hidden />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      className="max-w-xs bg-[#1A1A1A] border-[#333] text-foreground"
                    >
                      <p className="font-medium text-sm">
                        {ACHIEVEMENT_LABELS[a.code] ?? a.code}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {ACHIEVEMENT_HINTS[a.code] ?? "Achievement unlocked for this month."}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatAchievementDate(a.earnedAt)}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </TooltipProvider>
          )}

          <div className="flex flex-col items-center gap-2 py-2">
            <GoalProgressRing progress={progress} uncapped size="lg" />
            {goalRow?.closedAt && (
              <p className="text-xs text-muted-foreground text-center">
                {goalRow.achievedGoal ? "Goal hit" : "Missed goal"} · saved{" "}
                {goalRow.actualSavedAmount != null
                  ? `$${goalRow.actualSavedAmount.toLocaleString()}`
                  : "—"}
              </p>
            )}
            {isCurrentMonth && !goalRow?.closedAt && (
              <p className="text-xs text-muted-foreground text-center">In progress this month</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
