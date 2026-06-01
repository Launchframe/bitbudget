"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useApp } from "@/lib/app-context"
import { formatUsd, getEnvelopeBalanceAllTime } from "@/lib/data"
import { findSavingsEnvelope, savingsBalance } from "@/lib/savings-ui-metrics"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ChevronDown, Info } from "lucide-react"
import {
  AllocationComparisonBars,
  type AllocationBarSegment,
} from "@/components/allocation-stacked-bar"
import { EnvelopeFundSliders } from "@/components/envelope-fund-sliders"
import { ScrollOverflowHint } from "@/components/scroll-overflow-hint"
import { FillEnvelopesDialog, type FillEnvelopePreviewRow } from "@/components/fill-envelopes-dialog"
import {
  applyRebalanceQuickSelect,
  REBALANCE_QUICK_SELECTS,
  type RebalanceQuickSelectId,
} from "@/lib/rebalance-quick-selects"
import { clampRebalanceDeltas } from "@/lib/rebalance-math"
import type { RebalanceMode } from "@/lib/rebalance-envelopes"

type DialogStep = "adjust" | "confirm" | "success"

export function RebalanceEnvelopesDialog({
  open,
  onOpenChange,
  source = "pool",
  editBatchId,
  onOpenAddIncome,
  onFundFromSavings,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `savings` opens fund-from-Savings (independent sliders only). */
  source?: "pool" | "savings"
  editBatchId?: string | null
  /** When pool rebalance needs funded envelopes, open Add income (parent may close this dialog). */
  onOpenAddIncome?: () => void
  onFundFromSavings?: () => void
}) {
  const { discretionaryEnvelopes, activeEnvelopes, activeTransactions, refreshData, state } = useApp()
  const savingsEnv = findSavingsEnvelope(activeEnvelopes)
  const savingsBal = savingsBalance(activeTransactions, savingsEnv)

  const [preferFundFromSavings, setPreferFundFromSavings] = useState(false)
  const fundFromSavings = source === "savings" || preferFundFromSavings
  const defaultMode: RebalanceMode = fundFromSavings ? "independent" : "balanced"

  const [step, setStep] = useState<DialogStep>("adjust")
  const [manuallySetEnvelopes, setManuallySetEnvelopes] = useState<Set<string>>(() => new Set())
  const [mode, setMode] = useState<RebalanceMode>(defaultMode)
  const [multiplier, setMultiplier] = useState(1)
  const [deltas, setDeltas] = useState<Record<string, number>>({})
  const [fillOpen, setFillOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successSavingsDelta, setSuccessSavingsDelta] = useState(0)
  const [loadingEdit, setLoadingEdit] = useState(false)
  const [quickSelectsOpen, setQuickSelectsOpen] = useState(true)
  const customSnapshotRef = useRef<Record<string, number>>({})

  useEffect(() => {
    if (!open) setPreferFundFromSavings(false)
  }, [open])

  const getCurrentBalance = useCallback(
    (id: string) => getEnvelopeBalanceAllTime(activeTransactions, id),
    [activeTransactions],
  )

  const effectiveMode = fundFromSavings ? "independent" : mode

  const fundedEnvelopeCount = useMemo(
    () => discretionaryEnvelopes.filter((e) => getCurrentBalance(e.id) > 0.005).length,
    [discretionaryEnvelopes, getCurrentBalance],
  )

  /** Pool rebalance moves money between envelopes — need at least two with balance. */
  const needsIncomeFirst =
    !fundFromSavings && !editBatchId && fundedEnvelopeCount < 2

  const beforeSegments: AllocationBarSegment[] = useMemo(
    () =>
      discretionaryEnvelopes.map((e) => ({
        id: e.id,
        name: e.name,
        color: e.color,
        icon: e.icon,
        value: Math.max(0, getCurrentBalance(e.id)),
      })),
    [discretionaryEnvelopes, getCurrentBalance],
  )

  const afterSegments: AllocationBarSegment[] = useMemo(
    () =>
      discretionaryEnvelopes.map((e) => ({
        id: e.id,
        name: e.name,
        color: e.color,
        icon: e.icon,
        value: Math.max(0, getCurrentBalance(e.id) + (deltas[e.id] ?? 0)),
      })),
    [discretionaryEnvelopes, getCurrentBalance, deltas],
  )

  const entries = useMemo(() => {
    return Object.entries(deltas)
      .filter(([, d]) => Number.isFinite(d) && Math.abs(d) > 0.005)
      .map(([envelopeId, deltaUsd]) => ({ envelopeId, deltaUsd }))
  }, [deltas])

  const savingsNet = useMemo(() => {
    return Object.entries(deltas).reduce((s, [, v]) => {
      if (!Number.isFinite(v)) return s
      return s - v
    }, 0)
  }, [deltas])

  const previewRows: FillEnvelopePreviewRow[] = useMemo(() => {
    if (entries.length > 0) {
      return entries.map((e) => ({
        envelopeId: e.envelopeId,
        deltaUsd: e.deltaUsd,
        behaviorLabel: "Rebalance",
      }))
    }
    return discretionaryEnvelopes.map((e) => ({
      envelopeId: e.id,
      deltaUsd: 0,
      behaviorLabel: "Rebalance",
    }))
  }, [entries, discretionaryEnvelopes])

  const affectedCount = entries.length

  const envelopeQuickContext = useMemo(
    () =>
      discretionaryEnvelopes.map((e) => ({
        id: e.id,
        monthlyAllotment: e.monthlyAllotment,
        currentBalance: getCurrentBalance(e.id),
        sweepPolicy: e.sweepPolicy,
        sweepCapMultiplier: e.sweepCapMultiplier,
      })),
    [discretionaryEnvelopes, getCurrentBalance],
  )

  function snapshotCustom() {
    customSnapshotRef.current = { ...deltas }
  }

  const clampContext = useMemo(
    () =>
      discretionaryEnvelopes.map((e) => ({
        id: e.id,
        monthlyAllotment: e.monthlyAllotment,
        currentBalance: getCurrentBalance(e.id),
      })),
    [discretionaryEnvelopes, getCurrentBalance],
  )

  const applyClampedDeltas = useCallback(
    (raw: Record<string, number>, replaceAll = false) => {
      const clamped = clampRebalanceDeltas(raw, clampContext, {
        creditMultiplier: multiplier,
        savingsBalance: savingsBal,
      })
      setDeltas((prev) => {
        const merged = { ...prev }
        if (replaceAll) {
          for (const env of discretionaryEnvelopes) {
            if (!manuallySetEnvelopes.has(env.id)) delete merged[env.id]
          }
        }
        for (const env of discretionaryEnvelopes) {
          if (!replaceAll && manuallySetEnvelopes.has(env.id)) continue
          const v = clamped[env.id] ?? 0
          if (Math.abs(v) > 0.005) merged[env.id] = v
          else if (!manuallySetEnvelopes.has(env.id)) delete merged[env.id]
        }
        return merged
      })
    },
    [clampContext, multiplier, savingsBal, discretionaryEnvelopes, manuallySetEnvelopes],
  )

  function applyQuickSelect(id: RebalanceQuickSelectId) {
    snapshotCustom()
    const poolUsd =
      id === "proportional_fill" && state.monthlyIncome > 0
        ? Math.min(state.monthlyIncome, Math.max(0, savingsBal))
        : undefined
    const raw = applyRebalanceQuickSelect(id, envelopeQuickContext, {
      userDefaultSweepPolicy: null,
      userDefaultCapMultiplier: null,
      poolUsd,
    })
    const replaceAll = id === "sweep_to_savings" || id === "zero_base"
    applyClampedDeltas(raw, replaceAll)
  }

  function revertToCustom() {
    setDeltas({ ...customSnapshotRef.current })
  }

  function setCreditMultiplier(next: number) {
    setMultiplier(next)
    setDeltas((prev) =>
      clampRebalanceDeltas(prev, clampContext, {
        creditMultiplier: next,
        savingsBalance: savingsBal,
      }),
    )
  }

  const reset = useCallback(() => {
    setDeltas({})
    setMultiplier(1)
    setError(null)
    setSuccessSavingsDelta(0)
    setManuallySetEnvelopes(new Set())
    setMode(fundFromSavings ? "independent" : "balanced")
    setStep("adjust")
    setQuickSelectsOpen(true)
    customSnapshotRef.current = {}
  }, [fundFromSavings])

  useEffect(() => {
    if (!open) return
    reset()
    if (editBatchId) {
      setLoadingEdit(true)
      void fetch(`/api/transactions/batch/${encodeURIComponent(editBatchId)}/config`)
        .then((res) => res.json())
        .then((data: { config?: { mode?: RebalanceMode; entries?: { envelopeId: string; deltaUsd: number }[] } }) => {
          if (data.config?.entries) {
            const next: Record<string, number> = {}
            for (const e of data.config.entries) {
              next[e.envelopeId] = e.deltaUsd
            }
            setDeltas(next)
            customSnapshotRef.current = { ...next }
          }
          if (data.config?.mode === "balanced" || data.config?.mode === "independent") {
            setMode(data.config.mode)
          }
        })
        .catch(() => {})
        .finally(() => setLoadingEdit(false))
    }
  }, [open, editBatchId, reset])

  const submit = async () => {
    setError(null)
    if (entries.length === 0) {
      setError("Adjust at least one envelope.")
      return
    }
    setSubmitting(true)
    try {
      if (editBatchId) {
        const del = await fetch(`/api/transactions/batch/${encodeURIComponent(editBatchId)}`, {
          method: "DELETE",
        })
        if (!del.ok) {
          const delData = await del.json().catch(() => ({}))
          setError(
            typeof delData.error === "string"
              ? delData.error
              : "Could not replace the previous rebalance.",
          )
          return
        }
      }

      const res = await fetch("/api/transactions/rebalance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: effectiveMode,
          entries,
          config: { mode: effectiveMode, entries, multiplier, source },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not rebalance envelopes.")
        return
      }
      await refreshData()
      setSuccessSavingsDelta(savingsNet)
      setStep("success")
    } catch {
      setError("Network error — try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const title =
    editBatchId != null && editBatchId.length > 0
      ? "Edit rebalance"
      : fundFromSavings
        ? "Fund from Savings"
        : "Rebalance Envelopes"

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next)
          if (!next) reset()
        }}
      >
        <DialogContent className="!flex max-h-[90dvh] max-w-[min(96vw,32rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,32rem)]">
          <DialogHeader className="shrink-0 space-y-0 px-6 pt-6 pb-4">
            <DialogTitle className="pr-8">{title}</DialogTitle>
          </DialogHeader>

          <ScrollOverflowHint className="min-h-0 flex-1 basis-0 px-6 pb-6">
          {loadingEdit ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : step === "success" ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Envelopes rebalanced — Savings changed by {formatUsd(successSavingsDelta, 2)}
                {successSavingsDelta > 0 ? " (into envelopes)" : successSavingsDelta < 0 ? " (from envelopes)" : ""}
                .
              </p>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          ) : step === "confirm" ? (
            <FillEnvelopesDialog
              open
              onOpenChange={(next) => {
                if (!next) setStep("adjust")
              }}
              rows={previewRows}
              grossUsd={0}
              embedded
              onConfirm={() => void submit()}
              confirmLabel={submitting ? "Saving…" : editBatchId ? "Replace rebalance" : "Rebalance envelopes"}
            />
          ) : needsIncomeFirst ? (
            <div className="flex flex-col gap-4 min-w-0">
              <p className="text-sm text-foreground leading-relaxed">
                Rebalancing moves money between envelopes. You need a positive balance in at least two
                envelopes first.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Record income and choose &ldquo;Fill envelopes now,&rdquo; or move money from Savings
                into envelopes.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (onFundFromSavings) onFundFromSavings()
                    else setPreferFundFromSavings(true)
                  }}
                >
                  Dip into savings
                </Button>
                {onOpenAddIncome ? (
                  <Button
                    type="button"
                    className="bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/90"
                    onClick={() => {
                      onOpenChange(false)
                      onOpenAddIncome()
                    }}
                  >
                    Add income
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <>
                <div className="sticky top-0 z-10 -mx-6 bg-[#0D0D0D] px-6 pb-3 border-b border-[#333]/70 shadow-[0_10px_20px_-12px_rgba(0,0,0,0.9)]">
                  <AllocationComparisonBars
                    before={{
                      envelopes: beforeSegments,
                      savingsValue: savingsBal,
                    }}
                    after={{
                      envelopes: afterSegments,
                      savingsValue: Math.max(0, savingsBal + savingsNet),
                    }}
                  />
                </div>

                <div className="flex flex-col gap-4 pt-4 min-w-0">
              {!fundFromSavings ? (
                <div className="flex gap-2 flex-wrap">
                  <Button
                    type="button"
                    size="sm"
                    variant={mode === "balanced" ? "default" : "outline"}
                    onClick={() => {
                      snapshotCustom()
                      setMode("balanced")
                    }}
                  >
                    Balanced
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={mode === "independent" ? "default" : "outline"}
                    onClick={() => {
                      snapshotCustom()
                      setMode("independent")
                    }}
                  >
                    Let me choose for each
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Move money from Savings into envelopes. Savings balance: {formatUsd(savingsBal)}
                </p>
              )}

              <Collapsible open={quickSelectsOpen} onOpenChange={setQuickSelectsOpen}>
                <CollapsibleTrigger className="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-[#333] bg-[#111] px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-[#1A1A1A] transition-colors">
                  <span>Quick selects</span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 transition-transform ${quickSelectsOpen ? "rotate-180" : ""}`}
                    aria-hidden
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <div className="flex gap-1 flex-wrap">
                    {REBALANCE_QUICK_SELECTS.map(({ id, label }) => (
                      <Button
                        key={id}
                        type="button"
                        size="sm"
                        variant="outline"
                        className="text-xs"
                        onClick={() => applyQuickSelect(id)}
                      >
                        {label}
                      </Button>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      onClick={revertToCustom}
                    >
                      Revert to custom
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <EnvelopeFundSliders
                mode="move"
                grossUsd={0}
                moveCreditMultiplier={multiplier}
                valuesByEnvelopeId={deltas}
                manuallySetEnvelopes={manuallySetEnvelopes}
                rebalanceMode={effectiveMode}
                fundFromSavings={fundFromSavings}
                savingsBalance={savingsBal}
                scrollEnvelopeList={false}
                onChange={(envelopeId, amountUsd) => {
                  setDeltas((prev) => {
                    const merged = { ...prev, [envelopeId]: amountUsd }
                    const clamped = clampRebalanceDeltas(merged, clampContext, {
                      creditMultiplier: multiplier,
                      savingsBalance: savingsBal,
                    })
                    const next: Record<string, number> = { ...prev }
                    for (const id of Object.keys(merged)) {
                      const v = clamped[id]
                      if (v !== undefined && Math.abs(v) > 0.005) next[id] = v
                      else delete next[id]
                    }
                    return next
                  })
                }}
                onManualTouch={(id) => {
                  snapshotCustom()
                  setManuallySetEnvelopes((prev) => new Set(prev).add(id))
                }}
              />

              <div className="flex flex-col gap-2 min-w-0 border-t border-[#333] pt-3">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs font-medium text-muted-foreground">
                    Top-up limit (months of budget)
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex rounded-full p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50"
                        aria-label="What the top-up limit multipliers mean"
                      >
                        <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      sideOffset={6}
                      className="max-w-[min(96vw,18rem)] border border-[#333] bg-[#1A1A1A] px-3 py-2 text-foreground shadow-xl [&>svg]:hidden"
                    >
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        When you add money to an envelope from Savings, this caps how much you can
                        add in one move, as a multiple of that envelope&apos;s monthly budget. 1× is
                        up to one month&apos;s budget; 12× allows you to fund with a year&apos;s worth of budget. Moving
                        money out is still limited by what&apos;s already in the envelope.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex gap-1 flex-wrap" role="group" aria-label="Top-up limit multiplier">
                  {[1, 2, 3, 6, 12].map((m) => (
                    <Button
                      key={m}
                      type="button"
                      size="sm"
                      variant={multiplier === m ? "secondary" : "outline"}
                      aria-pressed={multiplier === m}
                      onClick={() => setCreditMultiplier(m)}
                    >
                      {m}×
                    </Button>
                  ))}
                </div>
              </div>

              <div className="min-h-6 flex items-center">
                <button
                  type="button"
                  className="text-sm text-[#3B82F6] hover:underline text-left"
                  onClick={() => setFillOpen(true)}
                >
                  {affectedCount > 0
                    ? `View ${affectedCount} affected envelope${affectedCount === 1 ? "" : "s"} →`
                    : "View envelopes (none selected yet) →"}
                </button>
              </div>

              {error ? (
                <p className="text-sm text-amber-400/95" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="flex justify-end gap-2 pb-1">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={submitting || entries.length === 0}
                  onClick={() => setStep("confirm")}
                >
                  Review changes
                </Button>
              </div>
                </div>
            </>
          )}
          </ScrollOverflowHint>
        </DialogContent>
      </Dialog>

      <FillEnvelopesDialog
        open={fillOpen}
        onOpenChange={setFillOpen}
        rows={previewRows}
        grossUsd={0}
        readOnly
      />
    </>
  )
}
