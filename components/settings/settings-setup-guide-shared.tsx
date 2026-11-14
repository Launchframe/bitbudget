"use client"

import { useMemo, useState } from "react"
import { Compass, RotateCcw } from "lucide-react"
import { useApp } from "@/lib/app-context"
import { SetupGuidePanel } from "@/components/setup-guide-panel"
import { UpgradeModal, type PremiumFeature } from "@/components/upgrade-modal"
import { setupGuideProgress, type SetupGuideTaskId } from "@/lib/setup-guide-status"
import { focusSettingsSection } from "@/lib/setup-guide-client"
import { useSetupGuideStatus } from "@/lib/use-setup-guide-status"
import { Switch } from "@/components/ui/switch"
import { SAVINGS_EXPERIENCE_DISMISSED } from "@/lib/constants"

function nextTaskShortLabel(id: SetupGuideTaskId, savingsEngaged: boolean): string {
  switch (id) {
    case "income":
      return "Set monthly income"
    case "allocations":
      return "Divide paycheck"
    case "first_expense":
      return "Record a transaction"
    case "savings_goal":
      return savingsEngaged ? "Set Savings goal" : "Set Savings target"
    case "first_sweep":
      return savingsEngaged ? "Sweep once" : "Move to Savings"
    case "account_email":
      return "Add account email"
    case "plaid":
      return "Connect bank"
    case "receipt_inbox":
      return "Receipt inbox"
    default:
      return "Continue setup"
  }
}

export function useSettingsSetupGuide() {
  const {
    state,
    navigateTo,
    openNewTransaction,
    updateSetupGuidePrefs,
    restartWalkthrough,
    hasPremiumFeatures,
  } = useApp()

  const { remote } = useSetupGuideStatus({ refetchOnWindowFocus: true })
  const [upgradeFeature, setUpgradeFeature] = useState<PremiumFeature | null>(null)

  const tasks = useMemo(() => remote?.tasks ?? [], [remote?.tasks])
  const progress = remote ? setupGuideProgress(tasks) : null
  const savingsEngaged = state.savingsExperience !== SAVINGS_EXPERIENCE_DISMISSED

  const nextTaskLabel = useMemo(() => {
    if (!remote || progress?.allComplete) return null
    const next = tasks.find((t) => !t.complete)
    return next ? nextTaskShortLabel(next.id, savingsEngaged) : null
  }, [remote, progress?.allComplete, tasks, savingsEngaged])

  const progressPct =
    progress && progress.totalCount > 0
      ? Math.round((progress.completedCount / progress.totalCount) * 100)
      : 0

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
        focusSettingsSection("data")
        break
      case "plaid":
      case "receipt_inbox":
        focusSettingsSection("integrations")
        break
      default:
        break
    }
  }

  return {
    state,
    remote,
    progress,
    tasks,
    nextTaskLabel,
    progressPct,
    upgradeFeature,
    setUpgradeFeature,
    handleToggleShowOnHome,
    handleTaskAction,
    restartWalkthrough,
  }
}

export type SettingsSetupGuideHandle = ReturnType<typeof useSettingsSetupGuide>

type BodyProps = {
  guide: SettingsSetupGuideHandle
  showHeader?: boolean
  className?: string
}

export function SettingsSetupGuideBody({ guide, showHeader = true, className }: BodyProps) {
  const {
    state,
    remote,
    progress,
    tasks,
    upgradeFeature,
    setUpgradeFeature,
    handleToggleShowOnHome,
    handleTaskAction,
    restartWalkthrough,
  } = guide

  return (
    <div className={className} data-walkthrough="settings-setup-guide">
      {showHeader && (
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-[#3B82F6]/20">
            <Compass className="h-5 w-5 text-[#3B82F6]" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Setup guide</h3>
        </div>
      )}

      <div className="flex items-start justify-between gap-3 mb-4 min-w-0">
        <div className="min-w-0">
          <span className="text-sm font-medium text-foreground block">Show setup guide on Home</span>
          <span className="text-xs text-muted-foreground">
            Track essentials on your dashboard. You can hide it from Home anytime — it stays here in
            Settings.
          </span>
        </div>
        <Switch
          checked={state.setupGuideShowOnDashboard}
          onCheckedChange={(checked) => void handleToggleShowOnHome(checked)}
          aria-label="Show setup guide on Home"
          className="shrink-0 mt-0.5"
        />
      </div>

      {state.setupGuideDismissed && (
        <p className="text-xs text-muted-foreground mb-4">
          Hidden from Home. Turn on the toggle above to show it on your dashboard again.
        </p>
      )}

      {!remote ? (
        <p className="text-sm text-muted-foreground py-4" role="status">
          Loading checklist…
        </p>
      ) : (
        <SetupGuidePanel
          tasks={tasks}
          completedCount={progress!.completedCount}
          totalCount={progress!.totalCount}
          allComplete={progress!.allComplete}
          hasPremiumFeatures={remote.hasPremiumFeatures}
          variant="settings"
          onTaskAction={handleTaskAction}
        />
      )}

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

export function SettingsSetupGuideCollapsedStrip({
  onOpen,
  progressPct,
  nextTaskLabel,
}: {
  onOpen: () => void
  progressPct: number
  nextTaskLabel: string | null
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-16 w-full items-center gap-3 border-t border-[#1F1F1F] bg-[#0D0D0D] px-4 text-left touch-manipulation"
      aria-label="Open setup guide"
    >
      <Compass className="h-5 w-5 shrink-0 text-[#3B82F6]" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="h-1.5 w-full rounded-full bg-[#1F1F1F] overflow-hidden mb-1.5">
          <div
            className="h-full rounded-full bg-[#3B82F6] transition-all duration-300"
            style={{ width: `${progressPct}%` }}
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Setup progress"
          />
        </div>
        <p className="text-xs font-medium text-foreground truncate">
          {nextTaskLabel ?? "Setup guide"}
        </p>
      </div>
    </button>
  )
}
