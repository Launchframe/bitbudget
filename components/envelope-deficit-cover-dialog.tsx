"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { formatUsd, getCurrentMonthKey, getEnvelopeBalance } from "@/lib/data"
import { deficitCoverAmount } from "@/lib/budget-period"
import { useApp } from "@/lib/app-context"
import { SavingsDrawdownSummary } from "@/components/savings-drawdown-summary"
import { findSavingsEnvelope, savingsBalance } from "@/lib/savings-ui-metrics"

export function EnvelopeDeficitCoverDialog({
  open,
  onOpenChange,
  envelopeId,
  envelopeName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  envelopeId: string
  envelopeName: string
}) {
  const { activeTransactions, refreshData, state } = useApp()
  const monthKey = getCurrentMonthKey()
  const monthBal = getEnvelopeBalance(activeTransactions, envelopeId, monthKey)
  const maxCover = deficitCoverAmount(monthBal)
  const [amount, setAmount] = useState(maxCover)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const savingsBal = savingsBalance(activeTransactions, findSavingsEnvelope(state.envelopes))

  const daysToFirst = (() => {
    const now = new Date()
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    return Math.max(0, Math.ceil((next.getTime() - now.getTime()) / 86_400_000))
  })()

  const submit = async () => {
    setError(null)
    const amt = Math.min(amount, maxCover)
    if (amt <= 0) return
    setSubmitting(true)
    try {
      const res = await fetch("/api/transactions/envelope-deficit-cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: [{ envelopeId, amount: amt }] }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not cover from Savings.")
        return
      }
      await refreshData()
      onOpenChange(false)
    } catch {
      setError("Network error — try again.")
    } finally {
      setSubmitting(false)
    }
  }

  if (maxCover <= 0) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Cover this overdraft?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Can you make it to the 1st without spending more? Covering from Savings is optional—it only brings{" "}
          <span className="text-foreground">{envelopeName}</span> back to $0, not a full refill.
          {daysToFirst > 0 ? ` About ${daysToFirst} day${daysToFirst === 1 ? "" : "s"} until the 1st.` : ""}
        </p>
        <p className="text-sm font-mono">
          Overdraft: {formatUsd(monthBal)} · Cover up to {formatUsd(maxCover)}
        </p>
        <label className="text-sm">
          Amount
          <input
            type="number"
            min={0}
            max={maxCover}
            step={0.01}
            value={amount}
            onChange={(e) => setAmount(Math.min(maxCover, Math.max(0, parseFloat(e.target.value) || 0)))}
            className="mt-1 w-full rounded-lg border border-[#333] bg-[#1A1A1A] px-3 py-2"
          />
        </label>
        <SavingsDrawdownSummary drawFromSavingsUsd={amount} savingsBalanceUsd={savingsBal} />
        {error ? (
          <p className="text-sm text-amber-400/95" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="secondary" disabled={submitting} onClick={() => void submit()}>
            {submitting ? "Covering…" : "Cover from Savings"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
