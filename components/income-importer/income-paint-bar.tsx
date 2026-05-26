"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { OnboardingAllocFineScroller } from "@/components/onboarding-alloc-fine-scroller"
import { INCOME_IMPORT_PAYEE_DEFAULT } from "@/lib/income-import"
import { incomeRelativeFineStep } from "@/lib/income-import-defaults"
import { SAVINGS_GOLD_ACCENT } from "@/lib/constants"

interface IncomePaintBarProps {
  amount: number
  source: string
  suggestedIncome: number
  onAmountChange: (amount: number) => void
  onSourceChange: (source: string) => void
}

export function IncomePaintBar({
  amount,
  source,
  suggestedIncome,
  onAmountChange,
  onSourceChange,
}: IncomePaintBarProps) {
  const fineStep = useMemo(() => incomeRelativeFineStep(suggestedIncome), [suggestedIncome])
  const [amountText, setAmountText] = useState(amount > 0 ? String(amount) : "")
  const skipAmountSyncRef = useRef(false)

  useEffect(() => {
    if (skipAmountSyncRef.current) {
      skipAmountSyncRef.current = false
      return
    }
    const external = amount > 0 ? String(amount) : ""
    requestAnimationFrame(() => setAmountText(external))
  }, [amount])

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[#1F1F1F] bg-[#111] p-4">
      <p className="text-xs text-muted-foreground">
        Income details that apply when you tap or drag on the calendar below.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="paint-amount">Paint amount (USD)</Label>
          <div className="flex items-center gap-2">
            <Input
              id="paint-amount"
              type="number"
              min={0}
              step="0.01"
              value={amountText}
              onChange={(e) => {
                skipAmountSyncRef.current = true
                const next = e.target.value
                setAmountText(next)
                const v = parseFloat(next)
                onAmountChange(Number.isFinite(v) && v > 0 ? v : 0)
              }}
              className="bg-[#1A1A1A] border-[#333]"
            />
            <OnboardingAllocFineScroller
              accentColor={SAVINGS_GOLD_ACCENT}
              ariaLabel="Adjust paint amount"
              value={amount}
              maxValue={Math.max(suggestedIncome * 2, 100000)}
              onGestureStart={() => {}}
              onNudge={(delta) => onAmountChange(Math.max(0, Math.round((amount + delta * fineStep) * 100) / 100))}
              onGestureEnd={() => {}}
            />
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="paint-source">Source label</Label>
          <Input
            id="paint-source"
            value={source}
            placeholder={INCOME_IMPORT_PAYEE_DEFAULT}
            onChange={(e) => onSourceChange(e.target.value)}
            className="bg-[#1A1A1A] border-[#333]"
          />
        </div>
      </div>
    </div>
  )
}
