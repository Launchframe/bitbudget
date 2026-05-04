"use client"

import { useCallback, useState } from "react"
import { useApp } from "@/lib/app-context"
import { formatUsd } from "@/lib/data"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Landmark } from "lucide-react"

function todayIso(): string {
  return new Date().toISOString().split("T")[0]!
}

export function IrregularIncomeDialog() {
  const { state, refreshData } = useApp()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(todayIso)
  const [payee, setPayee] = useState("")
  const [notes, setNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resetForm = useCallback(() => {
    setAmount("")
    setDate(todayIso())
    setPayee("")
    setNotes("")
    setError(null)
  }, [])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next)
      if (!next) resetForm()
    },
    [resetForm],
  )

  const submit = useCallback(async () => {
    setError(null)
    const amt = parseFloat(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Enter a positive amount.")
      return
    }
    const p = payee.trim()
    if (!p) {
      setError("Payee is required.")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/transactions/irregular-income", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amt,
          date,
          payee: p,
          notes: notes.trim() || null,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Could not record income.")
        return
      }
      await refreshData()
      handleOpenChange(false)
    } catch {
      setError("Network error — try again.")
    } finally {
      setSubmitting(false)
    }
  }, [amount, date, payee, notes, refreshData, handleOpenChange])

  if (!state.ledgerFundingEnabled) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="p-2.5 rounded-xl bg-[#1A1A1A] border border-[#333] text-muted-foreground hover:text-foreground hover:border-[#555] transition-colors"
        title="Record irregular income"
        aria-label="Record irregular income"
      >
        <Landmark className="h-4 w-4" />
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground max-w-sm">
          <DialogHeader>
            <DialogTitle>Irregular income</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Credits Savings and splits into envelopes using your allotment percentages vs Monthly Income (
            {state.monthlyIncome > 0 ? formatUsd(state.monthlyIncome) : "set income first"}).
          </p>

          <div className="flex flex-col gap-4 pt-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="irr-amount">Amount (USD)</Label>
              <Input
                id="irr-amount"
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="bg-[#1A1A1A] border-[#333]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="irr-date">Date</Label>
              <Input
                id="irr-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-[#1A1A1A] border-[#333]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="irr-payee">Payee</Label>
              <Input
                id="irr-payee"
                value={payee}
                onChange={(e) => setPayee(e.target.value)}
                placeholder="e.g. Bonus, freelance"
                className="bg-[#1A1A1A] border-[#333]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="irr-notes">Notes (optional)</Label>
              <Input
                id="irr-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="bg-[#1A1A1A] border-[#333]"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-amber-400/95" role="alert">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" className="bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/90" disabled={submitting} onClick={() => void submit()}>
              {submitting ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
