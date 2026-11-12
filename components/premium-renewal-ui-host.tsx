"use client"

import { useCallback, useEffect, useState } from "react"
import { Sparkles, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useApp } from "@/lib/app-context"
import {
  formatPremiumTrialEnd,
  postPremiumCheckout,
  type PremiumCheckoutPlan,
} from "@/lib/billing-checkout-client"
import {
  PREMIUM_PRICE_ANNUAL_USD,
  PREMIUM_PRICE_MONTHLY_USD,
} from "@/lib/constants"

async function startPremiumCheckout(
  plan: PremiumCheckoutPlan,
): Promise<{ message: string; simulated: boolean } | null> {
  const { ok, data } = await postPremiumCheckout(plan)
  if (!ok) {
    return { message: "Checkout is temporarily unavailable. Please try again later.", simulated: false }
  }
  if (data.checkoutUrl) {
    window.location.href = data.checkoutUrl
    return null
  }
  if (data.simulated && data.premiumTrialUntil) {
    const end = formatPremiumTrialEnd(data.premiumTrialUntil)
    return {
      message: `Premium trial active through ${end}. Premium features are unlocked.`,
      simulated: true,
    }
  }
  return {
    message:
      data.message ?? "Thanks — we saved your interest and will follow up when billing is live.",
    simulated: false,
  }
}

export function PremiumRenewalUiHost() {
  const {
    navigateTo,
    refreshData,
    premiumRenewalPrompt,
    premiumExpiredBanner,
    dismissPremiumRenewalUi,
  } = useApp()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [checkoutMessage, setCheckoutMessage] = useState<string | null>(null)
  const [checkoutMessageSimulated, setCheckoutMessageSimulated] = useState(false)
  const [checkoutBusy, setCheckoutBusy] = useState<PremiumCheckoutPlan | null>(null)

  useEffect(() => {
    setDialogOpen(Boolean(premiumRenewalPrompt))
  }, [premiumRenewalPrompt])

  const dismissPrompt = useCallback(async () => {
    if (premiumRenewalPrompt) {
      await dismissPremiumRenewalUi(premiumRenewalPrompt.logKey)
    }
    setDialogOpen(false)
  }, [dismissPremiumRenewalUi, premiumRenewalPrompt])

  const dismissExpiredBanner = useCallback(async () => {
    if (premiumExpiredBanner) {
      await dismissPremiumRenewalUi(premiumExpiredBanner.logKey)
    }
  }, [dismissPremiumRenewalUi, premiumExpiredBanner])

  const handleCheckout = useCallback(async (plan: PremiumCheckoutPlan) => {
    setCheckoutBusy(plan)
    setCheckoutMessage(null)
    setCheckoutMessageSimulated(false)
    try {
      const result = await startPremiumCheckout(plan)
      if (result) {
        setCheckoutMessage(result.message)
        setCheckoutMessageSimulated(result.simulated)
      }
      await refreshData()
    } finally {
      setCheckoutBusy(null)
    }
  }, [refreshData])

  const openReferrals = useCallback(() => {
    navigateTo("settings")
    void dismissPrompt()
  }, [dismissPrompt, navigateTo])

  return (
    <>
      <Dialog
        open={dialogOpen && !!premiumRenewalPrompt}
        onOpenChange={(open) => {
          if (!open) void dismissPrompt()
        }}
      >
        <DialogContent className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground max-w-[min(96vw,28rem)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#F7931A]">
              <Sparkles className="h-5 w-5 shrink-0" aria-hidden />
              {premiumRenewalPrompt?.headline}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-left space-y-3 pt-2">
              <span className="block">{premiumRenewalPrompt?.body}</span>
              {premiumRenewalPrompt?.referralLine ? (
                <span className="block text-sm">{premiumRenewalPrompt.referralLine}</span>
              ) : null}
              {premiumRenewalPrompt?.pricingLine ? (
                <span className="block text-sm font-medium text-foreground">{premiumRenewalPrompt.pricingLine}</span>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            <div className="flex flex-col sm:flex-row gap-2 w-full">
              <button
                type="button"
                disabled={checkoutBusy !== null}
                onClick={() => void handleCheckout("monthly")}
                className="w-full sm:flex-1 rounded-lg bg-[#F7931A] text-[#0D0D0D] font-semibold py-2.5 px-4 hover:bg-[#F7931A]/90 disabled:opacity-60"
              >
                {checkoutBusy === "monthly"
                  ? "Starting…"
                  : `${premiumRenewalPrompt?.ctaRenew ?? "Renew"} — $${PREMIUM_PRICE_MONTHLY_USD}/mo`}
              </button>
              <button
                type="button"
                disabled={checkoutBusy !== null}
                onClick={() => void handleCheckout("annual")}
                className="w-full sm:flex-1 rounded-lg border border-[#F7931A]/50 text-[#F7931A] font-semibold py-2.5 px-4 hover:bg-[#F7931A]/10 disabled:opacity-60"
              >
                {checkoutBusy === "annual"
                  ? "Starting…"
                  : `$${PREMIUM_PRICE_ANNUAL_USD}/year (2 months free)`}
              </button>
            </div>
            <button
              type="button"
              onClick={openReferrals}
              className="w-full text-sm font-medium text-[#3B82F6] hover:underline py-1"
            >
              {premiumRenewalPrompt?.ctaRefer ?? "Refer a friend"}
            </button>
            {checkoutMessage ? (
              <p
                className={`text-xs text-left w-full ${
                  checkoutMessageSimulated ? "text-[#22C55E]" : "text-muted-foreground"
                }`}
              >
                {checkoutMessage}
              </p>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {premiumExpiredBanner ? (
        <div className="rounded-xl border border-[#F7931A]/35 bg-[#F7931A]/10 px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-3">
          <Sparkles className="h-5 w-5 text-[#F7931A] shrink-0 mt-0.5" aria-hidden />
          <div className="flex-1 min-w-0 space-y-2">
            <p className="text-sm text-foreground font-medium">{premiumExpiredBanner.headline}</p>
            <p className="text-sm text-muted-foreground">{premiumExpiredBanner.body}</p>
            <p className="text-sm text-muted-foreground">{premiumExpiredBanner.pricingLine}</p>
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <button
                type="button"
                disabled={checkoutBusy !== null}
                onClick={() => void handleCheckout("monthly")}
                className="w-full sm:w-auto rounded-lg bg-[#F7931A] text-[#0D0D0D] font-semibold py-2 px-4 hover:bg-[#F7931A]/90 disabled:opacity-60"
              >
                {checkoutBusy === "monthly"
                  ? "Starting…"
                  : `${premiumExpiredBanner.ctaRenew} — $${PREMIUM_PRICE_MONTHLY_USD}/mo`}
              </button>
              <button
                type="button"
                disabled={checkoutBusy !== null}
                onClick={() => void handleCheckout("annual")}
                className="w-full sm:w-auto rounded-lg border border-[#F7931A]/50 text-[#F7931A] font-semibold py-2 px-4 hover:bg-[#F7931A]/10 disabled:opacity-60"
              >
                {checkoutBusy === "annual"
                  ? "Starting…"
                  : `$${PREMIUM_PRICE_ANNUAL_USD}/year (2 months free)`}
              </button>
            </div>
            {checkoutMessage ? (
              <p
                className={`text-xs ${checkoutMessageSimulated ? "text-[#22C55E]" : "text-muted-foreground"}`}
              >
                {checkoutMessage}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void dismissExpiredBanner()}
            className="text-muted-foreground hover:text-foreground shrink-0 self-start"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </>
  )
}
