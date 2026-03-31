"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"

export function ReferralTerms() {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-[#333] bg-[#1A1A1A]/50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-[#222] transition-colors"
      >
        Program terms
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (
        <div className="px-4 pb-4 text-xs text-muted-foreground space-y-2 border-t border-[#333] pt-3">
          <p>
            <strong className="text-foreground">Referrer:</strong> Your first activated referral earns 3 months of
            premium; each additional activation adds 1 month. If you&apos;re on the free plan, bonus premium is capped
            at 3 months total from now. Rewards apply when your friend connects their bank and completes a first sync.
          </p>
          <p>
            <strong className="text-foreground">Friend:</strong> 3 months of premium trial — Plaid sync, receipt inbox,
            and SMS alerts (up to 100 receipt/SMS captures per month combined).
          </p>
          <p>One referral per new account. You must finish onboarding before generating a code.</p>
        </div>
      )}
    </div>
  )
}
