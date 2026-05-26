"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useApp } from "@/lib/app-context"
import { discretionaryAllotmentSignature } from "@/lib/setup-guide-client"
import type { SetupGuideTaskStatus } from "@/lib/setup-guide-status"

export type SetupStatusResponse = {
  tasks: SetupGuideTaskStatus[]
  completedCount: number
  totalCount: number
  allComplete: boolean
  hasPremiumFeatures: boolean
  newlyAwarded?: number
}

type UseSetupGuideStatusOptions = {
  refetchOnWindowFocus?: boolean
}

export function useSetupGuideStatus(options: UseSetupGuideStatusOptions = {}) {
  const { refetchOnWindowFocus = false } = options
  const { state, activeTransactions, discretionaryEnvelopes } = useApp()

  const [remote, setRemote] = useState<SetupStatusResponse | null>(null)
  const completedCountRef = useRef(0)

  const allotmentSignature = useMemo(
    () => discretionaryAllotmentSignature(discretionaryEnvelopes),
    [discretionaryEnvelopes],
  )

  const applyStatus = useCallback((data: SetupStatusResponse, requestAchievementPoll: boolean) => {
    const prevCount = completedCountRef.current
    completedCountRef.current = data.completedCount
    setRemote(data)
    if (
      requestAchievementPoll &&
      ((data.newlyAwarded ?? 0) > 0 || data.completedCount > prevCount)
    ) {
      window.dispatchEvent(new Event("bitbudget-achievements-poll"))
    }
  }, [])

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/user/setup-status")
      if (!res.ok) return
      applyStatus((await res.json()) as SetupStatusResponse, false)
    } catch {
      /* ignore */
    }
  }, [applyStatus])

  const syncStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/user/setup-status", { method: "POST" })
      if (!res.ok) return
      applyStatus((await res.json()) as SetupStatusResponse, true)
    } catch {
      /* ignore */
    }
  }, [applyStatus])

  useEffect(() => {
    if (!refetchOnWindowFocus) return
    const onFocus = () => void loadStatus()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [loadStatus, refetchOnWindowFocus])

  useEffect(() => {
    const t = window.setTimeout(() => void loadStatus(), 0)
    return () => window.clearTimeout(t)
  }, [loadStatus, activeTransactions.length, state.monthlyIncome, allotmentSignature])

  return { remote, loadStatus, syncStatus }
}
