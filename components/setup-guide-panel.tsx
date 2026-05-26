"use client"

import { useMemo } from "react"
import { Check, Circle, Crown, Lock, Trophy } from "lucide-react"
import { useSession } from "next-auth/react"
import { useApp } from "@/lib/app-context"
import { SAVINGS_EXPERIENCE_DISMISSED, SAVINGS_GOLD_ACCENT } from "@/lib/constants"
import { ACHIEVEMENT_LABELS } from "@/lib/savings-ui-metrics"
import type { SetupGuideTaskId, SetupGuideTaskStatus } from "@/lib/setup-guide-status"
import { cn } from "@/lib/utils"

const TASK_ACHIEVEMENT: Partial<Record<SetupGuideTaskId, string>> = {
  allocations: "setup_allocations",
  first_sweep: "swept_first",
  plaid: "setup_plaid",
  receipt_inbox: "setup_receipt_inbox",
  account_email: "setup_account_email",
}

export type SetupGuidePanelVariant = "dashboard" | "settings"

export interface SetupGuidePanelProps {
  tasks: SetupGuideTaskStatus[]
  completedCount: number
  totalCount: number
  allComplete: boolean
  hasPremiumFeatures: boolean
  variant: SetupGuidePanelVariant
  onTaskAction: (id: SetupGuideTaskId) => void
  onSnooze?: () => void
  onDismissFromHome?: () => void
  className?: string
}

function taskCopy(
  id: SetupGuideTaskId,
  savingsEngaged: boolean,
): { title: string; helper: string; action: string } {
  switch (id) {
    case "income":
      return {
        title: "Set your monthly income",
        helper: "So we can suggest envelope amounts.",
        action: "Set income",
      }
    case "allocations":
      return {
        title: "Divide your paycheck",
        helper: "Give every envelope a monthly amount.",
        action: "Open allocations",
      }
    case "first_expense":
      return {
        title: "Record a transaction",
        helper: "Builds your spending picture.",
        action: "Add transaction",
      }
    case "savings_goal":
      return {
        title: savingsEngaged ? "Set a Savings goal" : "Set a Savings target",
        helper: savingsEngaged
          ? "Pick a target for this month."
          : "Choose a monthly target for Savings.",
        action: "Set goal",
      }
    case "first_sweep":
      return {
        title: savingsEngaged ? "Sweep once" : "Move balance to Savings",
        helper: savingsEngaged
          ? "Move leftover envelope money back to Savings."
          : "Return unspent envelope money to Savings.",
        action: "Sweep",
      }
    case "account_email":
      return {
        title: "Add an email for your account",
        helper: "Sign-in, recovery, and important updates — not bank receipt scanning.",
        action: "Add email",
      }
    case "plaid":
      return {
        title: "Connect your bank",
        helper: "Imports queue for your review before they post.",
        action: "Connect bank",
      }
    case "receipt_inbox":
      return {
        title: "Forward a receipt",
        helper: "Email a receipt to your inbox address once.",
        action: "Get inbox address",
      }
    default: {
      const _exhaustive: never = id
      return _exhaustive
    }
  }
}

function ProgressRing({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? completed / total : 0
  const radius = 20
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - pct)

  return (
    <div
      className="relative w-12 h-12 shrink-0"
      role="img"
      aria-label={`${completed} of ${total} essentials complete`}
    >
      <svg className="w-full h-full -rotate-90" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r={radius} fill="none" stroke="#1F1F1F" strokeWidth="4" />
        <circle
          cx="24"
          cy="24"
          r={radius}
          fill="none"
          stroke={SAVINGS_GOLD_ACCENT}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-foreground">
        {completed}/{total}
      </span>
    </div>
  )
}

export function SetupGuidePanel({
  tasks,
  completedCount,
  totalCount,
  allComplete,
  hasPremiumFeatures,
  variant,
  onTaskAction,
  onSnooze,
  onDismissFromHome,
  className,
}: SetupGuidePanelProps) {
  const { state } = useApp()
  const { data: session } = useSession()
  const savingsEngaged = state.savingsExperience !== SAVINGS_EXPERIENCE_DISMISSED

  const rows = useMemo(
    () =>
      tasks.map((t) => ({
        ...t,
        ...taskCopy(t.id, savingsEngaged),
        achievementCode: TASK_ACHIEVEMENT[t.id],
      })),
    [tasks, savingsEngaged],
  )

  const showPremiumUpsell = !hasPremiumFeatures && variant === "dashboard"

  return (
    <div
      className={cn(
        "rounded-2xl border border-[#333] bg-[#0D0D0D] p-4 sm:p-6 min-w-0 w-full max-w-full",
        savingsEngaged && "border-t-2",
        className,
      )}
      style={savingsEngaged ? { borderTopColor: SAVINGS_GOLD_ACCENT } : undefined}
      {...(variant === "dashboard" ? { "data-walkthrough": "setup-progress" } : {})}
    >
      <div className="flex flex-col sm:flex-row sm:items-start gap-4 min-w-0">
        <ProgressRing completed={completedCount} total={totalCount} />
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-foreground">
            {allComplete ? "You’re all set" : "Finish setting up"}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {allComplete
              ? "You’ve covered the essentials. Keep budgeting — or revisit this list in Settings anytime."
              : "A few steps to get the most from BitBudget. You can change anything later."}
          </p>
        </div>
        {variant === "dashboard" && !allComplete && (
          <div className="flex flex-wrap gap-2 sm:flex-col sm:items-end shrink-0">
            {onSnooze && (
              <button
                type="button"
                onClick={onSnooze}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Remind me later
              </button>
            )}
            {onDismissFromHome && (
              <button
                type="button"
                onClick={onDismissFromHome}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Hide from Home
              </button>
            )}
          </div>
        )}
      </div>

      <ul className="mt-4 flex flex-col gap-2" role="list">
        {rows.map((row) => {
          const locked = row.premiumOnly && !hasPremiumFeatures
          const achievementLabel = row.achievementCode
            ? ACHIEVEMENT_LABELS[row.achievementCode]
            : null

          return (
            <li
              key={row.id}
              className={cn(
                "flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 rounded-xl border border-[#1F1F1F] bg-[#1A1A1A]/80 min-w-0",
                row.complete && "opacity-80",
              )}
            >
              <div className="flex items-start gap-3 min-w-0 flex-1">
                {row.complete ? (
                  <Check className="h-5 w-5 shrink-0 text-[#22C55E]" aria-hidden />
                ) : locked ? (
                  <Lock className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                  <Circle className="h-5 w-5 shrink-0 text-[#444]" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{row.title}</p>
                  <p className="text-xs text-muted-foreground">{row.helper}</p>
                  {achievementLabel && !row.complete && (
                    <p className="text-[10px] text-muted-foreground/80 mt-1 flex items-center gap-1">
                      <Trophy className="h-3 w-3 shrink-0" style={{ color: SAVINGS_GOLD_ACCENT }} />
                      Unlocks: {achievementLabel}
                    </p>
                  )}
                </div>
              </div>
              {!row.complete && (
                <button
                  type="button"
                  onClick={() => onTaskAction(row.id)}
                  className={cn(
                    "shrink-0 w-full sm:w-auto text-xs font-medium px-3 py-2 rounded-lg transition-colors",
                    locked
                      ? "border border-[#333] text-muted-foreground hover:text-foreground"
                      : "bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/90",
                  )}
                >
                  {locked ? (
                    <span className="inline-flex items-center gap-1.5 justify-center">
                      <Crown className="h-3.5 w-3.5" />
                      Premium
                    </span>
                  ) : (
                    row.action
                  )}
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {showPremiumUpsell && (
        <p className="mt-3 text-xs text-muted-foreground">
          Premium adds bank sync and a receipt inbox — optional, whenever you&apos;re ready.
        </p>
      )}

      {variant === "settings" && !session?.user?.email && (
        <p className="mt-3 text-xs text-amber-200/90">
          Nostr-only accounts stay pseudonymous until you add an email. You can skip that step if you prefer.
        </p>
      )}
    </div>
  )
}
