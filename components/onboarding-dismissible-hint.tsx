"use client"

import { X } from "lucide-react"
import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"

export const ONBOARDING_HINT_SAVINGS_GOAL = "savings-goal"
export const ONBOARDING_HINT_SAVINGS_SWEEP = "savings-sweep"
export const ONBOARDING_HINT_REFERRAL_COMPLETE = "referral-complete"
export const ONBOARDING_HINT_REFERRAL_BANK = "referral-bank"

type OnboardingDismissibleHintProps = {
  hintId: string
  dismissed: boolean
  onDismiss: (hintId: string) => void
  children: ReactNode
  className?: string
  style?: CSSProperties
  dismissLabel?: string
}

export function OnboardingDismissibleHint({
  hintId,
  dismissed,
  onDismiss,
  children,
  className,
  style,
  dismissLabel = "Dismiss hint",
}: OnboardingDismissibleHintProps) {
  if (dismissed) return null

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border border-[#3B82F6]/35 bg-[#3B82F6]/10 px-4 py-3",
        className,
      )}
      style={style}
    >
      <div className="flex-1 min-w-0 space-y-2">{children}</div>
      <button
        type="button"
        onClick={() => onDismiss(hintId)}
        className="shrink-0 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
        aria-label={dismissLabel}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
