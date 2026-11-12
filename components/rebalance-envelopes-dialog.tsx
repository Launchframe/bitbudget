"use client"

import Link from "next/link"
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
import { todayTransactionCalendarDay } from "@/lib/transaction-dates"
import {
  countIneligibleQuickSelects,
  quickSelectWouldMoveDeltas,
} from "@/lib/rebalance-quick-select-eligibility"
import type { RebalanceMode } from "@/lib/rebalance-envelopes"
import { MOVE_TO_FROM_SAVINGS_TITLE } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { handleDialogEnterToPrimary } from "@/lib/dialog-enter-submit"

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
  const [activeQuickSelectId, setActiveQuickSelectId] = useState<
    RebalanceQuickSelectId | "custom" | null
  >(null)
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

  /** Total USD moving on any envelope — drives After stacked bar color (muted until positive). */
  const totalAbsMoveUsd = useMemo(
    () =>
      Object.values(deltas).reduce((sum, v) => {
        if (!Number.isFinite(v)) return sum
        return sum + Math.abs(v)
      }, 0),
    [deltas],
  )

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

  const confirmSavingsDrawUsd = useMemo(() => {
    if (!fundFromSavings) return undefined
    return previewRows.reduce((s, r) => s + (r.deltaUsd > 0.005 ? r.deltaUsd : 0), 0)
  }, [fundFromSavings, previewRows])

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

  const setupIncompleteForQuickActions = useMemo(() => {
    if (state.monthlyIncome <= 0) return true
    return !discretionaryEnvelopes.some(
      (e) => Number.isFinite(e.monthlyAllotment) && e.monthlyAllotment > 0.005,
    )
  }, [state.monthlyIncome, discretionaryEnvelopes])

  const quickSelectEligibilityInput = useMemo(
    () => ({
      envelopes: envelopeQuickContext,
      clampContext,
      monthlyIncome: state.monthlyIncome,
      savingsBal,
      creditMultiplier: multiplier,
    }),
    [envelopeQuickContext, clampContext, state.monthlyIncome, savingsBal, multiplier],
  )

  const ineligibleQuickActionCount = useMemo(
    () => countIneligibleQuickSelects(quickSelectEligibilityInput),
    [quickSelectEligibilityInput],
  )

  const fundedLiquidityCount = fundedEnvelopeCount + (savingsBal > 0.005 ? 1 : 0)
  const showInsufficientFundedHint =
    !fundFromSavings && !needsIncomeFirst && fundedLiquidityCount < 2

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
    setActiveQuickSelectId(id)
  }

  function revertToCustom() {
    setDeltas({ ...customSnapshotRef.current })
    setActiveQuickSelectId("custom")
  }

  function setCreditMultiplier(next: number) {
    setActiveQuickSelectId(null)
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
    setActiveQuickSelectId(null)
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
          postedOn: todayTransactionCalendarDay(),
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
    step === "confirm"
      ? "Review changes"
      : editBatchId != null && editBatchId.length > 0
        ? "Edit rebalance"
        : fundFromSavings
          ? MOVE_TO_FROM_SAVINGS_TITLE
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
        <DialogContent
          className="flex max-h-[90dvh] max-w-[min(96vw,32rem)] flex-col gap-0 overflow-hidden p-0 transition-all duration-200 ease-out sm:max-w-[min(96vw,32rem)]"
          onKeyDown={(e) =>
            handleDialogEnterToPrimary(e, {
              disabled:
                submitting ||
                loadingEdit ||
                (step === "confirm" && (submitting || entries.length === 0)) ||
                (step === "adjust" &&
                  (loadingEdit || needsIncomeFirst || entries.length === 0)),
              onPrimary: () => {
                if (step === "success") onOpenChange(false)
                else if (step === "confirm") void submit()
                else if (step === "adjust" && !needsIncomeFirst && entries.length > 0) setStep("confirm")
              },
            })
          }
        >
          <DialogHeader className="shrink-0 space-y-0 px-6 pt-6 pb-4">
            <DialogTitle className="pr-8">{title}</DialogTitle>
          </DialogHeader>

          {step === "confirm" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <ScrollOverflowHint className="max-h-[calc(90dvh-9.5rem)] min-h-0 px-6">
                <FillEnvelopesDialog
                  open
                  onOpenChange={(next) => {
                    if (!next) setStep("adjust")
                  }}
                  rows={previewRows}
                  grossUsd={0}
                  embedded
                  savingsDrawForSummaryUsd={fundFromSavings ? confirmSavingsDrawUsd : undefined}
                  savingsBalanceForSummaryUsd={fundFromSavings ? savingsBal : undefined}
                />
              </ScrollOverflowHint>
              <div className="flex shrink-0 flex-col gap-2 border-t border-[#333] bg-[#0D0D0D] px-6 py-4 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => setStep("adjust")}>
                  Back
                </Button>
                <Button
                  type="button"
                  disabled={submitting || entries.length === 0}
                  onClick={() => void submit()}
                >
                  {submitting ? "Saving…" : editBatchId ? "Replace rebalance" : "Rebalance envelopes"}
                </Button>
              </div>
            </div>
          ) : (
          <ScrollOverflowHint className="max-h-[calc(90dvh-5.5rem)] px-6 pb-6">
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
          ) : needsIncomeFirst ? (
            <div className="flex flex-col gap-4 min-w-0">
              <p className="text-sm text-foreground leading-relaxed">
                Rebalancing moves money between envelopes. You need a positive balance in at least two
                envelopes first.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {savingsBal > 0.005 ? (
                  <>
                    Record income and choose &ldquo;Fill envelopes now,&rdquo; or use{" "}
                    {MOVE_TO_FROM_SAVINGS_TITLE} from Adjust envelopes.
                  </>
                ) : (
                  <>
                    Record income and choose &ldquo;Fill envelopes now&rdquo; so you have balances to
                    move between envelopes.
                  </>
                )}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                {savingsBal > 0.005 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (onFundFromSavings) onFundFromSavings()
                      else setPreferFundFromSavings(true)
                    }}
                  >
                    {MOVE_TO_FROM_SAVINGS_TITLE}
                  </Button>
                ) : null}
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
                    afterMovementUsd={totalAbsMoveUsd}
                  />
                </div>

                <div className="flex flex-col gap-4 pt-4 min-w-0">
              <Collapsible open={quickSelectsOpen} onOpenChange={setQuickSelectsOpen}>
                <CollapsibleTrigger className="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-[#333] bg-[#222] px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-[#1A1A1A] transition-colors">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span>Quick actions</span>
                    {setupIncompleteForQuickActions && ineligibleQuickActionCount > 0 ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex shrink-0 rounded-full p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50"
                            aria-label="Why quick actions may be unavailable"
                          >
                            <Info className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          sideOffset={6}
                          className="max-w-[min(96vw,20rem)] border border-[#333] bg-[#1A1A1A] px-3 py-2 text-xs text-muted-foreground shadow-xl [&>svg]:hidden"
                        >
                          <p className="leading-relaxed">
                            To use quick actions, finish{" "}
                            <Link
                              href="/#/envelopes/allocations"
                              className="text-[#3B82F6] underline underline-offset-2 hover:text-[#60A5FA]"
                            >
                              setting up your monthly budget
                            </Link>
                            .
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                    {showInsufficientFundedHint ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex shrink-0 rounded-full p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50"
                            aria-label="Why some quick actions may be unavailable"
                          >
                            <Info className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          sideOffset={6}
                          className="max-w-[min(96vw,20rem)] border border-[#333] bg-[#1A1A1A] px-3 py-2 text-xs text-muted-foreground shadow-xl [&>svg]:hidden"
                        >
                          <p className="leading-relaxed">
                            It looks like you don&apos;t have enough funded envelopes to move money
                            right now.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 transition-transform ${quickSelectsOpen ? "rotate-180" : ""}`}
                    aria-hidden
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <div className="flex gap-1 flex-wrap">
                    {REBALANCE_QUICK_SELECTS.map(({ id, label }) => {
                      const wouldMove = quickSelectWouldMoveDeltas(id, quickSelectEligibilityInput)
                      const isActive = activeQuickSelectId === id
                      const showStrike = !wouldMove && !isActive
                      return (
                        <Button
                          key={id}
                          type="button"
                          size="sm"
                          variant={isActive ? "default" : "outline"}
                          aria-pressed={isActive}
                          className={cn(
                            "text-xs relative",
                            showStrike && "opacity-60",
                          )}
                          onClick={() => applyQuickSelect(id)}
                        >
                          <span className={cn("relative z-[1]", showStrike && "line-through decoration-red-500/90")}>
                            {label}
                          </span>
                        </Button>
                      )
                    })}
                    <Button
                      type="button"
                      size="sm"
                      variant={activeQuickSelectId === "custom" ? "default" : "outline"}
                      className="text-xs"
                      aria-pressed={activeQuickSelectId === "custom"}
                      onClick={revertToCustom}
                    >
                      Custom
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-[#333] bg-[#141414]/80 p-3 sm:p-4">
                {!fundFromSavings ? (
                  <div className="flex min-w-0 flex-col gap-2">
                    <p className="text-xs font-medium text-muted-foreground" id="rebalance-slider-mode-label">
                      How sliders work together
                    </p>
                    <div
                      className="flex flex-wrap gap-2"
                      role="group"
                      aria-labelledby="rebalance-slider-mode-label"
                    >
                      <Button
                        type="button"
                        size="sm"
                        variant={mode === "balanced" ? "default" : "outline"}
                        onClick={() => {
                          snapshotCustom()
                          setActiveQuickSelectId(null)
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
                          setActiveQuickSelectId(null)
                          setMode("independent")
                        }}
                      >
                        Let me choose for each
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Move money between Savings and your envelopes. Savings balance: {formatUsd(savingsBal)}
                  </p>
                )}

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
                    setActiveQuickSelectId(null)
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
              </div>

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
                        Caps the maximum amount you can add to your envelopes in this funding round, as a multiple of that envelope&apos;s monthly budget. 1× is
                        up to one month&apos;s budget; 12× allows you to fund a year&apos;s worth of budget.
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
          )}
        </DialogContent>
      </Dialog>

      <FillEnvelopesDialog
        open={fillOpen}
        onOpenChange={setFillOpen}
        rows={previewRows}
        grossUsd={0}
        readOnly
        savingsDrawForSummaryUsd={fundFromSavings ? confirmSavingsDrawUsd : undefined}
        savingsBalanceForSummaryUsd={fundFromSavings ? savingsBal : undefined}
      />
    </>
  )
}
