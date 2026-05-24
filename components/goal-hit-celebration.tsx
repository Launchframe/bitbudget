"use client"

import { useEffect, useState } from "react"
import { useApp } from "@/lib/app-context"
import { SAVINGS_EXPERIENCE_DISMISSED } from "@/lib/constants"
import { formatPeriodKeyLabel } from "@/lib/savings-ui-metrics"

const GOAL_HIT_SEEN_KEY = "bitbudget-goal-hit-seen"

export function GoalHitCelebration() {
  const { state } = useApp()
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (state.savingsExperience === SAVINGS_EXPERIENCE_DISMISSED) return

    let cancelled = false
    void (async () => {
      try {
        const res = await fetch("/api/user/savings-goals?from=2020-01&to=2099-12")
        if (!res.ok || cancelled) return
        const body = (await res.json()) as { goals?: Array<{ periodKey: string; achievedGoal?: boolean | null; closedAt?: string | null }> }
        const closed = (body.goals ?? []).filter((g) => g.closedAt && g.achievedGoal)
        if (closed.length === 0) return
        closed.sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""))
        const latest = closed[0]
        const seenKey = `${GOAL_HIT_SEEN_KEY}-${latest.periodKey}`
        if (localStorage.getItem(seenKey)) return
        localStorage.setItem(seenKey, "1")
        if (!cancelled) {
          setMessage(`You hit ${formatPeriodKeyLabel(latest.periodKey)}. Future you is grinning.`)
          setTimeout(() => setMessage(null), 6000)
        }
      } catch {
        // ignore
      }
    })()
    return () => {
      cancelled = true
    }
  }, [state.savingsExperience])

  if (!message) return null

  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl bg-[#D4AF37] text-[#0D0D0D] text-sm font-semibold shadow-lg animate-bounce"
    >
      {message}
    </div>
  )
}
