"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useApp } from "@/lib/app-context"
import { SetupGuidePanel } from "@/components/setup-guide-panel"
import { UpgradeModal, type PremiumFeature } from "@/components/upgrade-modal"
import {
  SETUP_GUIDE_SNOOZE_MS,
  setupGuideProgress,
  shouldShowSetupGuideOnDashboard,
  type SetupGuideTaskId,
  type SetupGuideTaskStatus,
} from "@/lib/setup-guide-status"
import { discretionaryAllotmentSignature, focusSettingsSection } from "@/lib/setup-guide-client"

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

  const [remote, setRemote] = useState<SetupStatusResponse | null>(null)
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

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const active =
        state.setupGuideSnoozedUntil != null &&
        new Date(state.setupGuideSnoozedUntil).getTime() > Date.now()
      setSnoozeActive(active)
    })
    return () => cancelAnimationFrame(raf)
  }, [state.setupGuideSnoozedUntil])

  if (!remote) return null

  const progress = setupGuideProgress(remote.tasks)

  const showOnDashboard = shouldShowSetupGuideOnDashboard({
    showOnDashboard: state.setupGuideShowOnDashboard,
    dismissed: state.setupGuideDismissed,
    snoozedUntil: state.setupGuideSnoozedUntil,
    allComplete: progress.allComplete,
  })

  if (!showOnDashboard || snoozeActive) return null

  async function handleSnooze() {
    const until = new Date(Date.now() + SETUP_GUIDE_SNOOZE_MS).toISOString()
    await updateSetupGuidePrefs({ setupGuideSnoozedUntil: until })
  }

  async function handleDismissFromHome() {
    await updateSetupGuidePrefs({
      setupGuideDismissed: true,
      setupGuideShowOnDashboard: false,
    })
  }

  function handleTaskAction(id: SetupGuideTaskId) {
    const premiumLocked =
      (id === "plaid" || id === "receipt_inbox") &&
      !hasPremiumFeatures &&
      !remote?.hasPremiumFeatures
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
    void loadStatus()
  }

  return (
    <>
      <SetupGuidePanel
        tasks={remote.tasks}
        completedCount={progress.completedCount}
        totalCount={progress.totalCount}
        allComplete={progress.allComplete}
        hasPremiumFeatures={remote.hasPremiumFeatures}
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
