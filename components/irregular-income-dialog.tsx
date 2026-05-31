"use client"

import { useCallback, useState } from "react"
import { useApp } from "@/lib/app-context"
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
import type { FillEnvelopePreviewRow } from "@/components/fill-envelopes-dialog"
import {
  MoveFundsPanel,
  type MoveFundsPanelConfig,
} from "@/components/move-funds-panel"
import { formatUsd } from "@/lib/data"

function todayIso(): string {
  return new Date().toISOString().split("T")[0]!
}

type Step = "details" | "distribute" | "confirm" | "success"

export function IrregularIncomeDialog({
  triggerVariant = "icon",
}: {
  triggerVariant?: "icon" | "button"
}) {
  const { refreshData } = useApp()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>("details")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(todayIso)
  const [payee, setPayee] = useState("")
  const [notes, setNotes] = useState("")
  const [destination, setDestination] = useState<"savings" | "envelopes">("savings")
  const [panelConfig, setPanelConfig] = useState<MoveFundsPanelConfig | null>(null)
  const [successSummary, setSuccessSummary] = useState({ gross: 0, toSavings: 0, toEnvelopes: 0 })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resetForm = useCallback(() => {
    setStep("details")
    setAmount("")
    setDate(todayIso())
    setPayee("")
    setNotes("")
    setDestination("savings")
    setPanelConfig(null)
    setError(null)
  }, [])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next)
      if (!next) resetForm()
    },
    [resetForm],
  )

  const grossNum = parseFloat(amount)

  const submit = useCallback(async () => {
    setError(null)
    if (!Number.isFinite(grossNum) || grossNum <= 0) {
      setError("Enter a positive amount.")
      return
    }
    const p = payee.trim()
    if (!p) {
      setError("Enter who paid you.")
      return
    }

    const body: Record<string, unknown> = {
      amount: grossNum,
      date,
      payee: p,
      notes: notes.trim() || null,
      distributionMode: destination,
    }

    if (destination === "envelopes" && panelConfig) {
      body.distributionBehavior = panelConfig.distributionBehavior
      body.fundOverageFromSavings = panelConfig.fundOverageFromSavings
      body.envelopeAllocations = panelConfig.previewRows.map((row) => ({
        envelopeId: row.envelopeId,
        amountUsd: row.deltaUsd,
      }))
    }

    setSubmitting(true)
    try {
      const res = await fetch("/api/transactions/irregular-income", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not record income.")
        return
      }
      const toEnvelopes = panelConfig?.previewRows.reduce((s, r) => s + r.deltaUsd, 0) ?? 0
      setSuccessSummary({
        gross: grossNum,
        toSavings: Math.max(0, grossNum - toEnvelopes),
        toEnvelopes,
      })
      await refreshData()
      setStep("success")
    } catch {
      setError("Network error — try again.")
    } finally {
      setSubmitting(false)
    }
  }, [grossNum, date, payee, notes, destination, panelConfig, refreshData])

  const previewRows: FillEnvelopePreviewRow[] =
    destination === "envelopes" && panelConfig ? panelConfig.previewRows : []

  return (
    <>
      {triggerVariant === "button" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="border-[#333] hover:border-[#D4AF37]/50"
        >
          <Landmark className="h-3.5 w-3.5 mr-1.5" aria-hidden />
          Add extra income
        </Button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="p-2.5 rounded-xl bg-[#1A1A1A] border border-[#333] text-muted-foreground hover:text-foreground hover:border-[#555] transition-colors"
          title="Add extra income"
          aria-label="Add extra income"
        >
          <Landmark className="h-4 w-4" />
        </button>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground max-w-[min(96vw,28rem)] max-h-[90vh] overflow-y-auto">
          {step === "details" && (
            <>
              <DialogHeader>
                <DialogTitle>Add extra income</DialogTitle>
              </DialogHeader>
              <p className="text-xs text-muted-foreground">
                Extra income goes to Savings by default. Spending envelopes refill on the 1st each month—you can
                optionally fill envelopes now.
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
                  <Label htmlFor="irr-payee">Who paid you</Label>
                  <Input
                    id="irr-payee"
                    value={payee}
                    onChange={(e) => setPayee(e.target.value)}
                    placeholder="e.g. Employer, freelance client"
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
              {error ? (
                <p className="text-sm text-amber-400/95" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/90"
                  onClick={() => {
                    setError(null)
                    if (!Number.isFinite(grossNum) || grossNum <= 0) {
                      setError("Enter a positive amount.")
                      return
                    }
                    if (!payee.trim()) {
                      setError("Enter who paid you.")
                      return
                    }
                    setStep("distribute")
                  }}
                >
                  Next
                </Button>
              </div>
            </>
          )}

          {step === "distribute" && (
            <>
              <DialogHeader>
                <DialogTitle>Where should it go?</DialogTitle>
              </DialogHeader>
              <fieldset className="flex flex-col gap-3">
                <label className="flex items-start gap-3 rounded-xl border border-[#F7931A]/40 bg-[#F7931A]/10 p-3 cursor-pointer">
                  <input
                    type="radio"
                    name="irr-dest"
                    checked={destination === "savings"}
                    onChange={() => setDestination("savings")}
                    className="mt-1 accent-[#F7931A]"
                  />
                  <span>
                    <span className="font-medium block">Put it in Savings</span>
                    <span className="text-xs text-muted-foreground">Recommended — envelopes refill on the 1st</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-xl border border-[#333] p-3 cursor-pointer">
                  <input
                    type="radio"
                    name="irr-dest"
                    checked={destination === "envelopes"}
                    onChange={() => setDestination("envelopes")}
                    className="mt-1 accent-[#F7931A]"
                  />
                  <span className="font-medium">Fill envelopes now</span>
                </label>
              </fieldset>
              {destination === "envelopes" && Number.isFinite(grossNum) ? (
                <MoveFundsPanel
                  grossUsd={grossNum}
                  sourceFunding="income"
                  onConfigChange={setPanelConfig}
                />
              ) : null}
              {error ? (
                <p className="text-sm text-amber-400/95" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="flex justify-between gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setStep("details")}>
                  Back
                </Button>
                <Button
                  type="button"
                  className="bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/90"
                  onClick={() => {
                    if (destination === "envelopes" && (!panelConfig || panelConfig.previewRows.length === 0)) {
                      setError("Choose a fill option or put the money in Savings.")
                      return
                    }
                    setError(null)
                    setStep("confirm")
                  }}
                >
                  Review
                </Button>
              </div>
            </>
          )}

          {step === "confirm" && (
            <>
              <DialogHeader>
                <DialogTitle>Confirm extra income</DialogTitle>
              </DialogHeader>
              <p className="text-sm">
                {formatUsd(grossNum)} from {payee.trim()} on {date}
              </p>
              {destination === "savings" ? (
                <p className="text-sm text-muted-foreground">All of this will land in Savings.</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {formatUsd(previewRows.reduce((s, r) => s + r.deltaUsd, 0))} across{" "}
                  {previewRows.length} envelope{previewRows.length === 1 ? "" : "s"}; remainder stays in Savings.
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setStep("distribute")}>
                  Back
                </Button>
                <Button
                  type="button"
                  className="bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/90"
                  disabled={submitting}
                  onClick={() => void submit()}
                >
                  {submitting ? "Saving…" : "Confirm"}
                </Button>
              </div>
              {error ? (
                <p className="text-sm text-amber-400/95" role="alert">
                  {error}
                </p>
              ) : null}
            </>
          )}

          {step === "success" && (
            <>
              <DialogHeader>
                <DialogTitle>Income recorded</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                {formatUsd(successSummary.gross)} recorded — {formatUsd(successSummary.toSavings)} to Savings
                {successSummary.toEnvelopes > 0
                  ? `, ${formatUsd(successSummary.toEnvelopes)} to envelopes`
                  : ""}
                .
              </p>
              <Button type="button" className="w-full" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
