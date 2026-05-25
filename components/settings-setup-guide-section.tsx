"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { Compass, RotateCcw } from "lucide-react"
import { useApp } from "@/lib/app-context"
import { SetupGuidePanel } from "@/components/setup-guide-panel"
import { UpgradeModal, type PremiumFeature } from "@/components/upgrade-modal"
import {
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
  hasPremiumFeatures: boolean
}

export function SettingsSetupGuideSection() {
  const {
    state,
    activeTransactions,
    discretionaryEnvelopes,
    navigateTo,
    openNewTransaction,
    updateSetupGuidePrefs,
    refreshSetupGuideStatus,
    restartWalkthrough,
    hasPremiumFeatures,
  } = useApp()
  const { data: session } = useSession()

  const [remote, setRemote] = useState<SetupStatusResponse | null>(null)
  const [savingsGoalSet, setSavingsGoalSet] = useState(false)
  const [upgradeFeature, setUpgradeFeature] = useState<PremiumFeature | null>(null)

  const allotmentSignature = useMemo(
    () => discretionaryAllotmentSignature(discretionaryEnvelopes),
    [discretionaryEnvelopes],
  )

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/user/setup-status")
      if (!res.ok) return
      setRemote((await res.json()) as SetupStatusResponse)
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

  const clientInput: SetupGuideClientInput = {
    monthlyIncome: state.monthlyIncome,
    envelopes: state.envelopes,
    transactions: activeTransactions,
    hasAccountEmail: Boolean(session?.user?.email),
    hasPremiumFeatures: remote?.hasPremiumFeatures ?? hasPremiumFeatures,
    savingsGoalSet,
    hasPlaidLink: remote?.tasks.find((t) => t.id === "plaid")?.complete ?? false,
    hasReceiptInboxActivity:
      remote?.tasks.find((t) => t.id === "receipt_inbox")?.complete ?? false,
  }

  const tasks = computeSetupGuideTasks(clientInput)
  const progress = setupGuideProgress(tasks)

  async function handleToggleShowOnHome(checked: boolean) {
    await updateSetupGuidePrefs({
      setupGuideShowOnDashboard: checked,
      ...(checked ? { setupGuideDismissed: false } : {}),
    })
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
        focusSettingsSection("general")
        break
      case "plaid":
      case "receipt_inbox":
        focusSettingsSection("integrations")
        break
      default:
        break
    }
    void refreshSetupGuideStatus()
  }

  return (
    <div className="p-6 bg-[#0D0D0D] rounded-2xl min-w-0 w-full max-w-full">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-[#3B82F6]/20">
          <Compass className="h-5 w-5 text-[#3B82F6]" />
        </div>
        <h3 className="text-lg font-semibold text-foreground">Setup guide</h3>
      </div>

      <label className="flex items-start gap-3 mb-4 cursor-pointer min-w-0">
        <input
          type="checkbox"
          checked={state.setupGuideShowOnDashboard}
          onChange={(e) => void handleToggleShowOnHome(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-[#333] accent-[#F7931A]"
        />
        <span className="min-w-0">
          <span className="text-sm font-medium text-foreground block">Show setup guide on Home</span>
          <span className="text-xs text-muted-foreground">
            Track essentials on your dashboard. You can hide it from Home anytime — it stays here in
            Settings.
          </span>
        </span>
      </label>

      {state.setupGuideDismissed && (
        <p className="text-xs text-muted-foreground mb-4">
          Hidden from Home. Turn on the toggle above to show it on your dashboard again.
        </p>
      )}

      <SetupGuidePanel
        tasks={tasks}
        completedCount={progress.completedCount}
        totalCount={progress.totalCount}
        allComplete={progress.allComplete}
        hasPremiumFeatures={remote?.hasPremiumFeatures ?? hasPremiumFeatures}
        variant="settings"
        onTaskAction={handleTaskAction}
      />

      <div className="mt-6 pt-4 border-t border-[#1F1F1F]">
        <p className="text-sm font-medium text-foreground mb-1">App tour</p>
        <p className="text-xs text-muted-foreground mb-3">
          Replay the short walkthrough of key screens and features.
        </p>
        <button
          type="button"
          onClick={() => void restartWalkthrough()}
          className="inline-flex items-center gap-2 text-sm font-medium text-[#F7931A] hover:text-[#F7931A]/80 transition-colors"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          Replay app tour
        </button>
      </div>

      <UpgradeModal
        feature={upgradeFeature ?? "plaid"}
        open={upgradeFeature !== null}
        onClose={() => setUpgradeFeature(null)}
      />
    </div>
  )
}
