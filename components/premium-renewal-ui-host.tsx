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
  PREMIUM_PRICE_ANNUAL_USD,
  PREMIUM_PRICE_MONTHLY_USD,
} from "@/lib/constants"

interface PremiumRenewalPrompt {
  logKey: string
  headline: string
  body: string
  referralLine: string
  pricingLine: string
  ctaRenew: string
  ctaRefer: string
  settingsReferralsPath: string
}

interface PremiumExpiredBannerState {
  logKey: string
  headline: string
  body: string
  pricingLine: string
  ctaRenew: string
}

type CheckoutPlan = "monthly" | "annual"

async function dismissPremiumRenewalPrompt(logKey: string): Promise<void> {
  await fetch("/api/user/premium-renewal-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ logKey }),
  })
}

async function startPremiumCheckout(plan: CheckoutPlan): Promise<string | null> {
  const res = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  })
  if (!res.ok) {
    return "Checkout is temporarily unavailable. Please try again later."
  }
  const data = (await res.json()) as { checkoutUrl?: string | null; message?: string }
  if (data.checkoutUrl) {
    window.location.href = data.checkoutUrl
    return data.checkoutUrl
  }
  return data.message ?? "Thanks — we saved your interest and will follow up when billing is live."
}

function parseRenewalState(settings: unknown): {
  prompt: PremiumRenewalPrompt | null
  expiredBanner: PremiumExpiredBannerState | null
} {
  if (!settings || typeof settings !== "object") {
    return { prompt: null, expiredBanner: null }
  }
  const s = settings as Record<string, unknown>
  const prompt = s.premiumRenewalPrompt
  const expiredBanner = s.premiumExpiredBanner
  return {
    prompt: prompt && typeof prompt === "object" ? (prompt as PremiumRenewalPrompt) : null,
    expiredBanner:
      expiredBanner && typeof expiredBanner === "object"
        ? (expiredBanner as PremiumExpiredBannerState)
        : null,
  }
}

export function PremiumRenewalUiHost() {
  const { navigateTo, refreshData } = useApp()
  const [prompt, setPrompt] = useState<PremiumRenewalPrompt | null>(null)
  const [expiredBanner, setExpiredBanner] = useState<PremiumExpiredBannerState | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [checkoutMessage, setCheckoutMessage] = useState<string | null>(null)
  const [checkoutBusy, setCheckoutBusy] = useState<CheckoutPlan | null>(null)

  const loadRenewalState = useCallback(async () => {
    try {
      const res = await fetch("/api/user/settings")
      if (!res.ok) return
      const settings = await res.json()
      const parsed = parseRenewalState(settings)
      setPrompt(parsed.prompt)
      setExpiredBanner(parsed.expiredBanner)
      setDialogOpen(Boolean(parsed.prompt))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void loadRenewalState()
  }, [loadRenewalState])

  const dismissPrompt = useCallback(async () => {
    if (prompt) {
      await dismissPremiumRenewalPrompt(prompt.logKey)
    }
    setDialogOpen(false)
    setPrompt(null)
  }, [prompt])

  const dismissExpiredBanner = useCallback(async () => {
    if (expiredBanner) {
      await dismissPremiumRenewalPrompt(expiredBanner.logKey)
    }
    setExpiredBanner(null)
  }, [expiredBanner])

  const handleCheckout = useCallback(async (plan: CheckoutPlan) => {
    setCheckoutBusy(plan)
    setCheckoutMessage(null)
    try {
      const message = await startPremiumCheckout(plan)
      if (message) setCheckoutMessage(message)
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
        open={dialogOpen && !!prompt}
        onOpenChange={(open) => {
          if (!open) void dismissPrompt()
        }}
      >
        <DialogContent className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground max-w-[min(96vw,28rem)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#F7931A]">
              <Sparkles className="h-5 w-5 shrink-0" aria-hidden />
              {prompt?.headline}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-left space-y-3 pt-2">
              <span className="block">{prompt?.body}</span>
              {prompt?.referralLine ? (
                <span className="block text-sm">{prompt.referralLine}</span>
              ) : null}
              {prompt?.pricingLine ? (
                <span className="block text-sm font-medium text-foreground">{prompt.pricingLine}</span>
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
                  : `${prompt?.ctaRenew ?? "Renew"} — $${PREMIUM_PRICE_MONTHLY_USD}/mo`}
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
              {prompt?.ctaRefer ?? "Refer a friend"}
            </button>
            {checkoutMessage ? (
              <p className="text-xs text-muted-foreground text-left w-full">{checkoutMessage}</p>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {expiredBanner ? (
        <div className="rounded-xl border border-[#F7931A]/35 bg-[#F7931A]/10 px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-3">
          <Sparkles className="h-5 w-5 text-[#F7931A] shrink-0 mt-0.5" aria-hidden />
          <div className="flex-1 min-w-0 space-y-2">
            <p className="text-sm text-foreground font-medium">{expiredBanner.headline}</p>
            <p className="text-sm text-muted-foreground">{expiredBanner.body}</p>
            <p className="text-sm text-muted-foreground">{expiredBanner.pricingLine}</p>
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <button
                type="button"
                disabled={checkoutBusy !== null}
                onClick={() => void handleCheckout("monthly")}
                className="w-full sm:w-auto rounded-lg bg-[#F7931A] text-[#0D0D0D] font-semibold py-2 px-4 hover:bg-[#F7931A]/90 disabled:opacity-60"
              >
                {checkoutBusy === "monthly"
                  ? "Starting…"
                  : `${expiredBanner.ctaRenew} — $${PREMIUM_PRICE_MONTHLY_USD}/mo`}
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
              <p className="text-xs text-muted-foreground">{checkoutMessage}</p>
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
