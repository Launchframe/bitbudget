"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useApp } from "@/lib/app-context"
import {
  activeTransactionSetupSignature,
  discretionaryAllotmentSignature,
  receiptInboxPendingSetupSignature,
} from "@/lib/setup-guide-client"
import {
  needsAllotmentSetupTracking,
  needsMonthlyIncomeSetupTracking,
  needsTransactionSetupTracking,
} from "@/lib/setup-guide-status"
import type { SetupStatusApiResponse } from "@/lib/setup-guide-status-api"

type UseSetupGuideStatusOptions = {
  refetchOnWindowFocus?: boolean
}

export function useSetupGuideStatus(options: UseSetupGuideStatusOptions = {}) {
  const { refetchOnWindowFocus = false } = options
  const { state, activeTransactions, discretionaryEnvelopes, pendingTransactions } = useApp()

  const [remote, setRemote] = useState<SetupStatusApiResponse | null>(null)
  // null = never loaded; 0 means user genuinely has no completed tasks after first load
  const completedCountRef = useRef<number | null>(null)
  const awardsBootstrappedRef = useRef(false)
  const setupIncompleteRef = useRef(true)

  const setupIncomplete = remote?.allComplete !== true

  const trackTransactions = useMemo(
    () =>
      remote == null ||
      needsTransactionSetupTracking(remote.tasks, state.monthlyIncome),
    [remote, state.monthlyIncome],
  )

  const trackAllotments = useMemo(
    () => remote == null || needsAllotmentSetupTracking(remote.tasks),
    [remote],
  )

  const trackMonthlyIncome = useMemo(
    () => remote == null || needsMonthlyIncomeSetupTracking(remote.tasks),
    [remote],
  )

  const transactionSetupSignature = useMemo(() => {
    if (!trackTransactions) return ""
    return activeTransactionSetupSignature(activeTransactions)
  }, [trackTransactions, activeTransactions])

  const allotmentSignature = useMemo(() => {
    if (!trackAllotments) return ""
    return discretionaryAllotmentSignature(discretionaryEnvelopes)
  }, [trackAllotments, discretionaryEnvelopes])

  const pendingReceiptInboxSignature = useMemo(() => {
    if (!trackTransactions) return ""
    return receiptInboxPendingSetupSignature(pendingTransactions)
  }, [trackTransactions, pendingTransactions])

  const monthlyIncomeTrigger = trackMonthlyIncome ? state.monthlyIncome : -1

  useEffect(() => {
    setupIncompleteRef.current = setupIncomplete
  }, [setupIncomplete])

  const applyStatus = useCallback((data: SetupStatusApiResponse, requestAchievementPoll: boolean) => {
    const prevCount = completedCountRef.current
    completedCountRef.current = data.completedCount
    setRemote(data)
    if (
      requestAchievementPoll &&
      // Only count-based dispatch after we've established a baseline (prevCount !== null).
      // On cold boot prevCount is null, so the poll fires only when achievements are
      // actually newly awarded in the same POST response — not spuriously on every refresh.
      ((data.newlyAwarded ?? 0) > 0 ||
        (prevCount !== null && data.completedCount > prevCount))
    ) {
      window.dispatchEvent(new Event("bitbudget-achievements-poll"))
    }
  }, [])

  const awardAndApply = useCallback(
    async (requestPoll: boolean) => {
      const res = await fetch("/api/user/setup-status", { method: "POST" })
      if (!res.ok) return false
      applyStatus((await res.json()) as SetupStatusApiResponse, requestPoll)
      return true
    },
    [applyStatus],
  )

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/user/setup-status")
      if (!res.ok) return
      const data = (await res.json()) as SetupStatusApiResponse
      const prevCount = completedCountRef.current
      // Guard: only treat count delta as "real progress" once we have a loaded baseline.
      // On cold boot prevCount is null, so progressIncreased is false and we rely solely
      // on bootstrapAwards to trigger the award POST.
      const progressIncreased = prevCount !== null && data.completedCount > prevCount
      const bootstrapAwards =
        !awardsBootstrappedRef.current && data.completedCount > 0

      if (progressIncreased || bootstrapAwards) {
        awardsBootstrappedRef.current = true
        const awarded = await awardAndApply(true)
        if (awarded) return
      }

      awardsBootstrappedRef.current = true
      applyStatus(data, false)
    } catch {
      /* ignore */
    }
  }, [applyStatus, awardAndApply])

  useEffect(() => {
    if (!refetchOnWindowFocus) return
    const onFocus = () => {
      if (!setupIncompleteRef.current) return
      void loadStatus()
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [loadStatus, refetchOnWindowFocus])

  useEffect(() => {
    if (!setupIncompleteRef.current) return
    const t = window.setTimeout(() => void loadStatus(), 0)
    return () => window.clearTimeout(t)
  }, [
    loadStatus,
    transactionSetupSignature,
    pendingReceiptInboxSignature,
    monthlyIncomeTrigger,
    allotmentSignature,
  ])

  return { remote, loadStatus }
}
