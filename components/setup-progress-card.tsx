"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { useApp } from "@/lib/app-context"
import { SetupGuidePanel } from "@/components/setup-guide-panel"
import { UpgradeModal, type PremiumFeature } from "@/components/upgrade-modal"
import {
  SETUP_GUIDE_SNOOZE_MS,
  computeSetupGuideTasks,
  setupGuideProgress,
  type SetupGuideClientInput,
  type SetupGuideTaskId,
  type SetupGuideTaskStatus,
} from "@/lib/setup-guide-status"
import { getCurrentMonthKey } from "@/lib/data"
import {
  discretionaryAllotmentSignature,
  fetchSavingsGoalSetForMonth,
  focusSettingsSection,
} from "@/lib/setup-guide-client"

type SetupStatusResponse = {
  tasks: SetupGuideTaskStatus[]
  completedCount: number
  totalCount: number
  allComplete: boolean
  hasPremiumFeatures: boolean
}

export function SetupProgressCard() {
  const {
    state,
    activeTransactions,
    discretionaryEnvelopes,
    navigateTo,
    openNewTransaction,
    updateSetupGuidePrefs,
    refreshSetupGuideStatus,
    hasPremiumFeatures,
  } = useApp()
  const { data: session } = useSession()

  const [remote, setRemote] = useState<SetupStatusResponse | null>(null)
  const [savingsGoalSet, setSavingsGoalSet] = useState(false)
  const [upgradeFeature, setUpgradeFeature] = useState<PremiumFeature | null>(null)
  const [snoozeActive, setSnoozeActive] = useState(false)

  const allotmentSignature = useMemo(
    () => discretionaryAllotmentSignature(discretionaryEnvelopes),
    [discretionaryEnvelopes],
  )

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/user/setup-status")
      if (!res.ok) return
      const data = (await res.json()) as SetupStatusResponse
      setRemote(data)
      window.dispatchEvent(new Event("bitbudget-achievements-poll"))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => void loadStatus(), 0)
    return () => window.clearTimeout(t)
  }, [loadStatus, activeTransactions.length, state.monthlyIncome, allotmentSignature])

  const monthKey = getCurrentMonthKey()

  const refreshSavingsGoal = useCallback(async () => {
    setSavingsGoalSet(await fetchSavingsGoalSetForMonth(monthKey))
  }, [monthKey])

  useEffect(() => {
    const t = window.setTimeout(() => void refreshSavingsGoal(), 0)
    const onFocus = () => void refreshSavingsGoal()
    window.addEventListener("focus", onFocus)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener("focus", onFocus)
    }
  }, [refreshSavingsGoal])

  const clientInput: SetupGuideClientInput | null = remote
    ? {
        monthlyIncome: state.monthlyIncome,
        envelopes: state.envelopes,
        transactions: activeTransactions,
        hasAccountEmail: Boolean(session?.user?.email),
        hasPremiumFeatures: remote.hasPremiumFeatures ?? hasPremiumFeatures,
        savingsGoalSet,
        hasPlaidLink: remote.tasks.find((t) => t.id === "plaid")?.complete ?? false,
        hasReceiptInboxActivity:
          remote.tasks.find((t) => t.id === "receipt_inbox")?.complete ?? false,
      }
    : null

  const tasks = clientInput ? computeSetupGuideTasks(clientInput) : (remote?.tasks ?? [])
  const progress = setupGuideProgress(tasks)

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const active =
        state.setupGuideSnoozedUntil != null &&
        new Date(state.setupGuideSnoozedUntil).getTime() > Date.now()
      setSnoozeActive(active)
    })
    return () => cancelAnimationFrame(raf)
  }, [state.setupGuideSnoozedUntil])

  if (!state.setupGuideShowOnDashboard || state.setupGuideDismissed || snoozeActive) {
    return null
  }

  async function handleSnooze() {
    const until = new Date(Date.now() + SETUP_GUIDE_SNOOZE_MS).toISOString()
    await updateSetupGuidePrefs({ setupGuideSnoozedUntil: until })
  }

  async function handleDismissFromHome() {
    await updateSetupGuidePrefs({ setupGuideDismissed: true })
  }

  function handleTaskAction(id: SetupGuideTaskId) {
    const premiumLocked =
      (id === "plaid" || id === "receipt_inbox") && !hasPremiumFeatures && !remote?.hasPremiumFeatures
    if (premiumLocked) {
      setUpgradeFeature(id === "plaid" ? "plaid" : "receipt_inbox")
      return
    }

    switch (id) {
      case "income":
        navigateTo("envelopes")
        break
      case "allocations":
        navigateTo("envelopes", undefined, { openAllocations: true })
        break
      case "first_expense":
        openNewTransaction()
        break
      case "savings_goal":
      case "first_sweep":
        navigateTo("envelopes")
        break
      case "account_email":
        navigateTo("settings")
        focusSettingsSection("general")
        break
      case "plaid":
      case "receipt_inbox":
        navigateTo("settings")
        focusSettingsSection("integrations")
        break
      default:
        break
    }
    void refreshSetupGuideStatus()
  }

  return (
    <>
      <SetupGuidePanel
        tasks={tasks}
        completedCount={progress.completedCount}
        totalCount={progress.totalCount}
        allComplete={progress.allComplete}
        hasPremiumFeatures={remote?.hasPremiumFeatures ?? hasPremiumFeatures}
        variant="dashboard"
        onTaskAction={handleTaskAction}
        onSnooze={progress.allComplete ? undefined : handleSnooze}
        onDismissFromHome={progress.allComplete ? undefined : handleDismissFromHome}
      />
      <UpgradeModal
        feature={upgradeFeature ?? "plaid"}
        open={upgradeFeature !== null}
        onClose={() => setUpgradeFeature(null)}
      />
    </>
  )
}
