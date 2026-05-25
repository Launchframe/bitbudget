"use client"

import { useState } from "react"
import { TrendingUp } from "lucide-react"
import { IncomeImporterDialog } from "@/components/income-importer/income-importer-dialog"

/** Prominent Settings card — mirrors Import Transactions on Integrations. */
export function IncomeImporterCard() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div className="p-6 bg-[#0D0D0D] rounded-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-[#D4AF37]/10">
            <TrendingUp className="h-5 w-5 text-[#D4AF37]" aria-hidden />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Import Income History</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Paint monthly or annual income on a calendar so Savings and analytics reflect your real cash flow. Past
          periods credit Savings only; the current month and future periods also fund your envelopes.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#333] bg-[#1A1A1A] px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-[#222] sm:w-auto"
        >
          <TrendingUp className="h-4 w-4 text-[#D4AF37]" aria-hidden />
          Import income history
        </button>
      </div>
      <IncomeImporterDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
