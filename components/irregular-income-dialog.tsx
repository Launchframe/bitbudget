"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import { Landmark, PiggyBank, Wallet } from "lucide-react"
import { SuccessParticles } from "@/components/success-particles"
import { SAVINGS_GOLD_ACCENT } from "@/lib/constants"
import { FillEnvelopesDialog } from "@/components/fill-envelopes-dialog"
import {
  DistributionPanel,
  type DistributionPanelConfig,
} from "@/components/distribution-panel"
import { SavingsOptionHeadline } from "@/components/savings-drawdown-summary"
import { formatUsd } from "@/lib/data"
import { findSavingsEnvelope, savingsBalance } from "@/lib/savings-ui-metrics"
import { useTransactionCaptureReadiness } from "@/lib/use-transaction-capture-readiness"
import { clearDraft } from "@/lib/draft-storage"
import { handleDialogEnterToPrimary } from "@/lib/dialog-enter-submit"
import {
  IRREGULAR_INCOME_DRAFT_KEY,
  loadIrregularIncomeDraft,
  saveIrregularIncomeDraft,
} from "@/lib/irregular-income-draft"

function todayIso(): string {
  return new Date().toISOString().split("T")[0]!
}

type Step = "details" | "distribute" | "confirm" | "success"

export function IrregularIncomeDialog({
  triggerVariant = "icon",
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  hideTrigger = false,
}: {
  triggerVariant?: "icon" | "button"
  /** When set with `onOpenChange`, controls dialog visibility (e.g. open from Rebalance). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}) {
  const { refreshData, state, activeTransactions } = useApp()
  const { readiness, loading: readinessLoading } = useTransactionCaptureReadiness()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const [step, setStep] = useState<Step>("details")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(todayIso)
  const [payee, setPayee] = useState("")
  const [notes, setNotes] = useState("")
  const [destination, setDestination] = useState<"savings" | "envelopes">("savings")
  const [panelConfig, setPanelConfig] = useState<DistributionPanelConfig | null>(null)
  const [successSummary, setSuccessSummary] = useState({
    gross: 0,
    toSavings: 0,
    toEnvelopes: 0,
    payee: "",
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const draftLoadedRef = useRef(false)

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
      controlledOnOpenChange?.(next)
      if (controlledOpen === undefined) setInternalOpen(next)
      if (!next) {
        draftLoadedRef.current = false
        resetForm()
      }
    },
    [controlledOpen, controlledOnOpenChange, resetForm],
  )

  const grossNum = parseFloat(amount)

  const savingsBalForSummary = useMemo(
    () => savingsBalance(activeTransactions, findSavingsEnvelope(state.envelopes)),
    [activeTransactions, state.envelopes],
  )

  const canReviewEnvelopes =
    destination === "envelopes" &&
    panelConfig != null &&
    !panelConfig.distributionInvalid &&
    panelConfig.fundableRows.length > 0

  useEffect(() => {
    if (!open) {
      draftLoadedRef.current = false
      return
    }
    if (draftLoadedRef.current) return
    draftLoadedRef.current = true
    const d = loadIrregularIncomeDraft()
    if (!d) return
    setAmount(d.amount)
    setDate(d.date)
    setPayee(d.payee)
    setNotes(d.notes)
    setDestination(d.destination)
    if (d.step === "distribute") setStep("distribute")
  }, [open])

  useEffect(() => {
    if (!open) return
    if (step === "success" || step === "confirm") return
    const persistStep = step === "distribute" ? "distribute" : "details"
    saveIrregularIncomeDraft({
      v: 1,
      step: persistStep,
      amount,
      date,
      payee,
      notes,
      destination,
    })
  }, [open, step, amount, date, payee, notes, destination])

  const goDetailsNext = useCallback(() => {
    setError(null)
    if (!readiness.ok) {
      setError(readiness.message)
      return
    }
    if (!Number.isFinite(grossNum) || grossNum <= 0) {
      setError("Enter a positive amount.")
      return
    }
    if (!payee.trim()) {
      setError("Please enter a payer.")
      return
    }
    setStep("distribute")
  }, [readiness, grossNum, payee])

  const goDistributeReview = useCallback(() => {
    if (destination === "envelopes") {
      if (!panelConfig || panelConfig.distributionInvalid) {
        setError("This distribution cannot be funded. Adjust the fill option or use Savings.")
        return
      }
      if (panelConfig.fundableRows.length === 0) {
        setError("Choose a fill option or put the money in Savings.")
        return
      }
    }
    setError(null)
    setStep("confirm")
  }, [destination, panelConfig])

  const submit = useCallback(async () => {
    setError(null)
    if (!readiness.ok) {
      setError(readiness.message)
      return
    }
    if (!Number.isFinite(grossNum) || grossNum <= 0) {
      setError("Enter a positive amount.")
      return
    }
    const p = payee.trim()
    if (!p) {
      setError("Please enter a payer.")
      return
    }
    if (destination === "envelopes") {
      if (!panelConfig || panelConfig.distributionInvalid || panelConfig.fundableRows.length === 0) {
        setError("Fix the envelope distribution before confirming.")
        return
      }
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
      body.envelopeAllocations = panelConfig.fundableRows.map((row) => ({
        envelopeId: row.envelopeId,
        amountUsd: row.deltaUsd,
      }))
      if (panelConfig.customByEnvelopeId) {
        body.customByEnvelopeId = panelConfig.customByEnvelopeId
      }
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
      clearDraft(IRREGULAR_INCOME_DRAFT_KEY)
      const toEnvelopes = panelConfig?.fundableRows.reduce((s, r) => s + r.deltaUsd, 0) ?? 0
      setSuccessSummary({
        gross: grossNum,
        toSavings: Math.max(0, grossNum - toEnvelopes),
        toEnvelopes,
        payee: p,
      })
      await refreshData()
      setStep("success")
    } catch {
      setError("Network error — try again.")
    } finally {
      setSubmitting(false)
    }
  }, [
    grossNum,
    date,
    payee,
    notes,
    destination,
    panelConfig,
    refreshData,
    readiness,
  ])

  const readinessBlock =
    !readinessLoading && !readiness.ok ? (
      <p className="text-sm text-amber-400/95 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2" role="alert">
        {readiness.message}
      </p>
    ) : null

  return (
    <>
      {!hideTrigger ? (
        triggerVariant === "button" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleOpenChange(true)}
            className="border-[#333] hover:border-[#D4AF37]/50"
          >
            <Landmark className="h-3.5 w-3.5 mr-1.5" aria-hidden />
            Add new income
          </Button>
        ) : (
          <button
            type="button"
            onClick={() => handleOpenChange(true)}
            className="p-2.5 rounded-xl bg-[#1A1A1A] border border-[#333] text-muted-foreground hover:text-foreground hover:border-[#555] transition-colors"
            title="Add new income"
            aria-label="Add new income"
          >
            <Landmark className="h-4 w-4" />
          </button>
        )
      ) : null}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground max-w-[min(96vw,28rem)] max-h-[90vh] overflow-y-auto transition-all duration-200 ease-out"
          onKeyDown={(e) =>
            handleDialogEnterToPrimary(e, {
              disabled:
                submitting ||
                step === "success" ||
                (step === "details" && (!readiness.ok || readinessLoading)) ||
                (step === "distribute" && destination === "envelopes" && !canReviewEnvelopes) ||
                (step === "confirm" &&
                  (!readiness.ok ||
                    submitting ||
                    (destination === "envelopes" && !canReviewEnvelopes))),
              onPrimary: () => {
                if (step === "details") goDetailsNext()
                else if (step === "distribute") goDistributeReview()
                else if (step === "confirm") void submit()
                else if (step === "success") handleOpenChange(false)
              },
            })
          }
        >
          {step === "details" && (
            <>
              <DialogHeader>
                <DialogTitle>Add new income</DialogTitle>
              </DialogHeader>
              {readinessBlock}
              <p className="text-xs text-muted-foreground">
                New income goes to Savings by default. Spending envelopes refill on the 1st each month—you can
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
                  disabled={!readiness.ok && !readinessLoading}
                  onClick={() => void goDetailsNext()}
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
              {readinessBlock}
              <fieldset className="flex flex-col gap-3">
                <label className="flex items-start gap-3 rounded-xl border border-[#F7931A]/40 bg-[#F7931A]/10 p-3 cursor-pointer">
                  <input
                    type="radio"
                    name="irr-dest"
                    checked={destination === "savings"}
                    onChange={() => {
                      setDestination("savings")
                      setError(null)
                    }}
                    className="mt-1 accent-[#F7931A]"
                  />
                  <span>
                    <span className="font-medium flex flex-wrap items-baseline gap-2">
                      Put it in Savings
                      {Number.isFinite(grossNum) && grossNum > 0 && state.monthlyIncome > 0 ? (
                        <SavingsOptionHeadline
                          depositUsd={grossNum}
                          monthlyIncomeUsd={state.monthlyIncome}
                        />
                      ) : null}
                    </span>
                    <span className="text-xs text-muted-foreground">Recommended</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-xl border border-[#333] p-3 cursor-pointer">
                  <input
                    type="radio"
                    name="irr-dest"
                    checked={destination === "envelopes"}
                    onChange={() => {
                      setDestination("envelopes")
                      setError(null)
                    }}
                    className="mt-1 accent-[#F7931A]"
                  />
                  <span className="font-medium">Fill envelopes now</span>
                </label>
              </fieldset>
              {destination === "envelopes" && Number.isFinite(grossNum) ? (
                <DistributionPanel
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
                  disabled={destination === "envelopes" && !canReviewEnvelopes}
                  onClick={() => void goDistributeReview()}
                >
                  Review
                </Button>
              </div>
            </>
          )}

          {step === "confirm" && (
            <>
              <DialogHeader>
                <DialogTitle>Confirm new income</DialogTitle>
              </DialogHeader>
              <p className="text-sm">
                {formatUsd(grossNum)} from {payee.trim()} on {date}
              </p>
              {destination === "savings" ? (
                <p className="text-sm text-muted-foreground">All of this will land in Savings.</p>
              ) : panelConfig ? (
                <FillEnvelopesDialog
                  embedded
                  open
                  onOpenChange={() => {}}
                  rows={panelConfig.requestedRows}
                  fundedRows={panelConfig.fundableRows}
                  grossUsd={grossNum}
                  readOnly
                  distributionInvalid={panelConfig.distributionInvalid}
                  invalidReason={panelConfig.invalidReason}
                  savingsDrawForSummaryUsd={panelConfig.fromSavingsUsd}
                  savingsBalanceForSummaryUsd={savingsBalForSummary}
                />
              ) : null}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setError(null)
                    setStep("distribute")
                  }}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  className="bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/90"
                  disabled={
                    submitting ||
                    !readiness.ok ||
                    (destination === "envelopes" && !canReviewEnvelopes)
                  }
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
              <SuccessParticles opportunityCostEnabled={state.opportunityCostEnabled} />
              <div className="relative flex flex-col items-center gap-5 py-2 text-center min-w-0">
                <DialogHeader className="sr-only">
                  <DialogTitle>New income added</DialogTitle>
                </DialogHeader>

                <div
                  className="rounded-full border p-4 animate-[bounce_1.2s_ease-in-out_infinite] motion-reduce:animate-none"
                  style={{
                    backgroundColor: `${SAVINGS_GOLD_ACCENT}22`,
                    borderColor: `${SAVINGS_GOLD_ACCENT}55`,
                    transformOrigin: "center bottom",
                  }}
                  aria-hidden
                >
                  <PiggyBank className="h-12 w-12" style={{ color: SAVINGS_GOLD_ACCENT }} />
                </div>

                <div className="space-y-2 min-w-0 w-full">
                  <h2 className="text-xl font-semibold text-foreground">
                    {successSummary.toEnvelopes > 0.005
                      ? "Nice — income is on its way"
                      : "You paid yourself first"}
                  </h2>
                  <p className="text-sm text-muted-foreground max-w-[20rem] mx-auto leading-relaxed">
                    {successSummary.payee ? (
                      <>
                        <span className="text-foreground font-medium">{successSummary.payee}</span>
                        {" · "}
                      </>
                    ) : null}
                    {formatUsd(successSummary.gross)} is in your budget.
                    {successSummary.toEnvelopes <= 0.005
                      ? " Every dollar landed in Savings — the habit that makes the rest of budgeting easier."
                      : " You chose how to split it between Savings and your envelopes."}
                  </p>
                </div>

                <div className="w-full flex flex-col gap-2 text-left">
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-[#D4AF37]/35 bg-[#D4AF37]/10 px-4 py-3">
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground min-w-0">
                      <PiggyBank className="h-4 w-4 shrink-0" style={{ color: SAVINGS_GOLD_ACCENT }} aria-hidden />
                      Savings
                    </span>
                    <span className="text-sm font-semibold tabular-nums shrink-0" style={{ color: SAVINGS_GOLD_ACCENT }}>
                      +{formatUsd(successSummary.toSavings)}
                    </span>
                  </div>
                  {successSummary.toEnvelopes > 0.005 ? (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#333] bg-[#1A1A1A]/80 px-4 py-3">
                      <span className="flex items-center gap-2 text-sm font-medium text-foreground min-w-0">
                        <Wallet className="h-4 w-4 shrink-0 text-[#F7931A]" aria-hidden />
                        Envelopes
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-[#F7931A] shrink-0">
                        +{formatUsd(successSummary.toEnvelopes)}
                      </span>
                    </div>
                  ) : null}
                </div>

                <Button
                  type="button"
                  className="w-full bg-[#D4AF37] text-[#0D0D0D] hover:bg-[#D4AF37]/90 font-medium"
                  onClick={() => handleOpenChange(false)}
                >
                  Got it
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
