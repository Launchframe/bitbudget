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
  const completedCountRef = useRef(0)
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
      ((data.newlyAwarded ?? 0) > 0 || data.completedCount > prevCount)
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
      const progressIncreased = data.completedCount > prevCount
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
