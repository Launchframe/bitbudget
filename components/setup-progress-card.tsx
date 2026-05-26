"use client"

import { useState } from "react"
import { useApp } from "@/lib/app-context"
import { SetupGuidePanel } from "@/components/setup-guide-panel"
import { UpgradeModal, type PremiumFeature } from "@/components/upgrade-modal"
import {
  SETUP_GUIDE_SNOOZE_MS,
  setupGuideProgress,
  shouldShowSetupGuideOnDashboard,
  type SetupGuideTaskId,
} from "@/lib/setup-guide-status"
import { focusSettingsSection } from "@/lib/setup-guide-client"
import { useSetupGuideStatus } from "@/lib/use-setup-guide-status"

export function SetupProgressCard() {
  const {
    navigateTo,
    openNewTransaction,
    updateSetupGuidePrefs,
    hasPremiumFeatures,
  } = useApp()

  const { remote, loadStatus } = useSetupGuideStatus()
  const [upgradeFeature, setUpgradeFeature] = useState<PremiumFeature | null>(null)

  if (!remote) return null

  const progress = setupGuideProgress(remote.tasks)

  const showOnDashboard = shouldShowSetupGuideOnDashboard({
    showOnDashboard: remote.setupGuideShowOnDashboard,
    dismissed: remote.setupGuideDismissed,
    snoozedUntil: remote.setupGuideSnoozedUntil,
    allComplete: progress.allComplete,
  })

  if (!showOnDashboard) return null

  async function handleSnooze() {
    const until = new Date(Date.now() + SETUP_GUIDE_SNOOZE_MS).toISOString()
    await updateSetupGuidePrefs({ setupGuideSnoozedUntil: until })
    void loadStatus()
  }

  async function handleDismissFromHome() {
    await updateSetupGuidePrefs({
      setupGuideDismissed: true,
      setupGuideShowOnDashboard: false,
    })
    void loadStatus()
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
