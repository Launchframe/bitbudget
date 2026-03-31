"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"

/** Shown once after onboarding when referral trial was redeemed (sessionStorage flag). */
export function TrialWelcomeBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let cancelled = false
    const id = requestAnimationFrame(() => {
      if (cancelled) return
      try {
        if (sessionStorage.getItem("bitbudget-trial-welcome") === "1") {
          sessionStorage.removeItem("bitbudget-trial-welcome")
          setVisible(true)
        }
      } catch {
        /* ignore */
      }
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(id)
    }
  }, [])

  if (!visible) return null

  return (
    <div className="rounded-xl border border-[#22C55E]/30 bg-[#22C55E]/10 px-4 py-3 flex items-start gap-3">
      <p className="text-sm text-[#86EFAC] flex-1">
        Welcome! You have premium trial features for 3 months — bank sync, receipt inbox, and SMS (100 captures/month).
      </p>
      <button
        type="button"
        onClick={() => setVisible(false)}
        className="text-[#86EFAC]/70 hover:text-[#86EFAC] shrink-0"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
