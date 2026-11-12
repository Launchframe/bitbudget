"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, AlertCircle, X } from "lucide-react"
import {
  consumeReferralRedeemFlash,
  type ReferralRedeemFlash,
} from "@/lib/referral-redeem-messages"

/**
 * One-time success/error banner after referral redeem (e.g. from Settings while user is on Dashboard).
 */
export function ReferralRedeemFlashBanner() {
  const [flash, setFlash] = useState<ReferralRedeemFlash | null>(null)

  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      setFlash(consumeReferralRedeemFlash())
    })
    return () => cancelAnimationFrame(rafId)
  }, [])

  if (!flash) return null

  const isSuccess = flash.type === "success"

  return (
    <div
      role={isSuccess ? "status" : "alert"}
      className={
        isSuccess
          ? "rounded-xl border border-[#22C55E]/30 bg-[#22C55E]/10 px-4 py-3 flex items-start gap-3"
          : "rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 flex items-start gap-3"
      }
    >
      {isSuccess ? (
        <CheckCircle2 className="h-5 w-5 text-[#22C55E] shrink-0 mt-0.5" aria-hidden />
      ) : (
        <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" aria-hidden />
      )}
      <p className={`text-sm flex-1 min-w-0 ${isSuccess ? "text-[#86EFAC]" : "text-red-300"}`}>
        {flash.message}
      </p>
      <button
        type="button"
        onClick={() => setFlash(null)}
        className="text-muted-foreground hover:text-foreground shrink-0"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
