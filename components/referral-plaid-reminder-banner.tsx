"use client"

import { useCallback, useState } from "react"
import { Building2, X } from "lucide-react"
import { useApp } from "@/lib/app-context"
import { requestSettingsIntegrationsTab } from "@/lib/payee-mapping-dismissals"
import {
  isReferralPlaidReminderSnoozed,
  snoozeReferralPlaidReminder,
} from "@/lib/referral-plaid-reminder"
import {
  REFEREE_PREMIUM_CARROT_FALLBACK,
  refereePremiumExperienceCarrot,
} from "@/lib/subscription"

/**
 * Nudges referees who skipped the onboarding bank step: premium trial starts only after Plaid.
 * Snoozed per-user in localStorage for a few days.
 */
export function ReferralPlaidReminderBanner() {
  const { refereePendingBankLink, referralRefereeTrialMonths, currentUserId, navigateTo } = useApp()
  /** Hide until next refresh after dismiss (snooze is persisted separately). */
  const [dismissedThisSession, setDismissedThisSession] = useState(false)

  const visible = Boolean(
    !dismissedThisSession &&
      refereePendingBankLink &&
      currentUserId &&
      !isReferralPlaidReminderSnoozed(currentUserId),
  )

  const openIntegrations = useCallback(() => {
    requestSettingsIntegrationsTab()
    navigateTo("settings")
  }, [navigateTo])

  const dismiss = useCallback(() => {
    if (currentUserId) snoozeReferralPlaidReminder(currentUserId, 4)
    setDismissedThisSession(true)
  }, [currentUserId])

  if (!visible) return null

  const carrot =
    referralRefereeTrialMonths === 1 || referralRefereeTrialMonths === 3
      ? refereePremiumExperienceCarrot(referralRefereeTrialMonths)
      : REFEREE_PREMIUM_CARROT_FALLBACK

  return (
    <div className="rounded-xl border border-[#3B82F6]/35 bg-[#3B82F6]/10 px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-3">
      <Building2 className="h-5 w-5 text-[#3B82F6] shrink-0 mt-0.5" aria-hidden />
      <div className="flex-1 min-w-0 space-y-2">
        <p className="text-sm text-foreground font-medium">Connect your bank to start your premium trial</p>
        <p className="text-sm text-muted-foreground">{carrot}</p>
        <button
          type="button"
          onClick={openIntegrations}
          className="text-sm font-semibold text-[#3B82F6] hover:underline"
        >
          Open Settings → Integrations
        </button>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="text-muted-foreground hover:text-foreground shrink-0 self-start sm:self-center"
        aria-label="Remind me later"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
