"use client"

import { useState, useMemo, useRef, useCallback } from "react"
import { useApp } from "@/lib/app-context"
import { formatUsd } from "@/lib/data"
import { Input } from "@/components/ui/input"
import { Check, Info, X, PiggyBank } from "lucide-react"
import { EnvelopeIconDisplay } from "@/components/envelope-icon-display"
import { OnboardingAllocFineScroller } from "@/components/onboarding-alloc-fine-scroller"
import {
  AllocationStackedBar,
  type AllocationBarSegment,
} from "@/components/allocation-stacked-bar"
import {
  nudgeOnboardingAllocationAmount,
  ONBOARDING_ALLOCATE_FINE_STEP,
} from "@/lib/onboarding-allocate-budget"
import {
  formatAllotmentInputDisplay,
  monthlyFromMoneyInput,
  parsePartialMoneyInput,
  roundMoneyCents,
} from "@/lib/allocation-cadence"
import {
  RetroMissedPaycheckDialog,
  fetchRetroMissedPaycheckStatus,
} from "@/components/retro-missed-paycheck-dialog"

/** Draft value for an envelope: user override or current allotment. Avoids syncing state in useEffect. */
function useDraftAllotments() {
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const getDraft = (envId: string, base: number) => overrides[envId] ?? base
  const setDraft = (envId: string, value: number) =>
    setOverrides(prev => ({ ...prev, [envId]: roundMoneyCents(value) }))
  return { getDraft, setDraft }
}

const ALLOCATION_SLIDER_STEP = 5

/** Align range input value to step so browsers don't clamp unpredictably when draft ≠ multiple of step. */
function snapSliderDisplayValue(value: number, max: number, step: number): number {
  const snapped = Math.round(value / step) * step
  return Math.min(max, Math.max(0, snapped))
}

export function EnvelopeAllocationsPage() {
  const { state, discretionaryEnvelopes, navigateTo, editEnvelope, setMonthlyIncome } = useApp()
  const activeEnvelopes = useMemo(
    () => discretionaryEnvelopes,
    [discretionaryEnvelopes]
  )
  const { getDraft, setDraft } = useDraftAllotments()
  const [activeSliderEnvId, setActiveSliderEnvId] = useState<string | null>(null)
  const [editingIncome, setEditingIncome] = useState(false)
  const [incomeValue, setIncomeValue] = useState("")
  const [mergeHintDismissed, setMergeHintDismissed] = useState(() => {
    try { return localStorage.getItem("bitbudget-merge-hint-dismissed") === "1" } catch { return false }
  })
  const [textDrafts, setTextDrafts] = useState<Record<string, string>>({})
  const [focusedAmountEnvId, setFocusedAmountEnvId] = useState<string | null>(null)
  const sliderRowRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const retroAfterSaveRef = useRef(false)
  const [retroDialogOpen, setRetroDialogOpen] = useState(false)
  const [retroPreviewGross, setRetroPreviewGross] = useState(0)

  function dismissMergeHint() {
    setMergeHintDismissed(true)
    try { localStorage.setItem("bitbudget-merge-hint-dismissed", "1") } catch {}
  }

  function handleCancel() {
    navigateTo("envelopes")
  }

  async function handleSave() {
    for (const env of activeEnvelopes) {
      const newVal = getDraft(env.id, env.monthlyAllotment)
      if (newVal !== env.monthlyAllotment) {
        editEnvelope(env.id, { monthlyAllotment: newVal })
      }
    }
    const status = await fetchRetroMissedPaycheckStatus()
    if (
      status &&
      status.eligible &&
      !status.applied &&
      Number.isFinite(status.previewGrossUsd) &&
      status.previewGrossUsd >= 0.01
    ) {
      retroAfterSaveRef.current = true
      setRetroPreviewGross(status.previewGrossUsd)
      setRetroDialogOpen(true)
      return
    }
    navigateTo("envelopes")
  }

  const handleRetroDialogOpenChange = useCallback(
    (next: boolean) => {
      setRetroDialogOpen(next)
      if (!next && retroAfterSaveRef.current) {
        retroAfterSaveRef.current = false
        navigateTo("envelopes")
      }
    },
    [navigateTo],
  )

  const draftTotalAllocated = activeEnvelopes.reduce(
    (s, e) => s + getDraft(e.id, e.monthlyAllotment),
    0
  )
  const draftSavings = Math.max(0, roundMoneyCents(state.monthlyIncome - draftTotalAllocated))
  const draftSavingsPct = state.monthlyIncome > 0 ? Math.round((draftSavings / state.monthlyIncome) * 100) : 0
  const showAllocStackBar = state.monthlyIncome > 0 && draftTotalAllocated > 0

  const allocBarSegments: AllocationBarSegment[] = useMemo(
    () =>
      activeEnvelopes
        .map((env) => ({
          id: env.id,
          name: env.name,
          color: env.color,
          icon: env.icon,
          value: getDraft(env.id, env.monthlyAllotment),
        }))
        .filter((s) => s.value > 0),
    [activeEnvelopes, getDraft],
  )

  const clearTextDraft = useCallback((envId: string) => {
    setTextDrafts(prev => {
      if (!(envId in prev)) return prev
      const next = { ...prev }
      delete next[envId]
      return next
    })
  }, [])

  if (activeEnvelopes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 bg-[#0D0D0D] rounded-2xl">
        <p className="text-muted-foreground text-sm">No envelopes to allocate. Create envelopes first.</p>
        <button
          type="button"
          onClick={() => navigateTo("envelopes")}
          className="px-4 py-2 bg-[#F7931A] text-[#0D0D0D] rounded-lg text-sm font-medium hover:bg-[#F7931A]/90"
        >
          Back to Envelopes
        </button>
      </div>
    )
  }

  if (state.monthlyIncome <= 0) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 md:p-6 bg-[#0D0D0D] rounded-2xl">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Monthly Income</span>
            {editingIncome ? (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">$</span>
                <Input
                  type="number"
                  value={incomeValue}
                  onChange={(e) => setIncomeValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const parsed = parseFloat(incomeValue)
                      setMonthlyIncome(Number.isFinite(parsed) ? parsed : state.monthlyIncome)
                      setEditingIncome(false)
                    }
                    if (e.key === "Escape") setEditingIncome(false)
                  }}
                  onBlur={() => {
                    const parsed = parseFloat(incomeValue)
                    setMonthlyIncome(Number.isFinite(parsed) ? parsed : state.monthlyIncome)
                    setEditingIncome(false)
                  }}
                  className="bg-[#1A1A1A] border-[#333] text-foreground h-9 w-36"
                  autoFocus
                />
              </div>
            ) : (
              <button
                onClick={() => {
                  setIncomeValue(String(state.monthlyIncome))
                  setEditingIncome(true)
                }}
                className="text-3xl font-bold text-foreground hover:text-[#F7931A] transition-colors text-left"
              >
                {formatUsd(state.monthlyIncome)}
              </button>
            )}
          </div>
        </div>
        <p className="text-muted-foreground text-sm">Set your monthly income above to allocate it across envelopes.</p>
        <button
          type="button"
          onClick={() => navigateTo("envelopes")}
          className="self-start px-4 py-2 bg-[#1A1A1A] border border-[#333] text-foreground rounded-lg text-sm font-medium"
        >
          Back to Envelopes
        </button>
      </div>
    )
  }

  return (
    <>
    <div className="flex flex-col gap-6">
      {/* Income header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 md:p-6 bg-[#0D0D0D] rounded-2xl">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Monthly Income</span>
          {editingIncome ? (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">$</span>
              <Input
                type="number"
                value={incomeValue}
                onChange={(e) => setIncomeValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const parsed = parseFloat(incomeValue)
                    if (Number.isFinite(parsed)) {
                      setMonthlyIncome(parsed)
                    } else {
                      setIncomeValue(String(state.monthlyIncome))
                    }
                    setEditingIncome(false)
                  }
                  if (e.key === "Escape") setEditingIncome(false)
                }}
                onBlur={() => {
                  const parsed = parseFloat(incomeValue)
                  if (Number.isFinite(parsed)) {
                    setMonthlyIncome(parsed)
                  } else {
                    setIncomeValue(String(state.monthlyIncome))
                  }
                  setEditingIncome(false)
                }}
                className="bg-[#1A1A1A] border-[#333] text-foreground h-9 w-36"
                autoFocus
              />
            </div>
          ) : (
            <button
              onClick={() => {
                setIncomeValue(String(state.monthlyIncome))
                setEditingIncome(true)
              }}
              className="text-3xl font-bold text-foreground hover:text-[#F7931A] transition-colors text-left"
            >
              {formatUsd(state.monthlyIncome)}
            </button>
          )}
        </div>
        <div className="flex items-center gap-4 sm:gap-6">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Allocated</span>
            <span className="text-lg font-semibold text-foreground">{formatUsd(draftTotalAllocated)}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Savings</span>
            <span className={`text-lg font-semibold ${draftSavings >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
              {formatUsd(draftSavings)}
            </span>
          </div>
        </div>
      </div>

      {/* Allocation sliders */}
      <div className="flex flex-col gap-4 p-4 md:p-6 bg-[#0D0D0D] rounded-2xl">
        <style>{`
          input[type="range"].env-alloc-slider {
            -webkit-appearance: none;
            appearance: none;
            width: 100%;
            height: 6px;
            border-radius: 3px;
            outline: none;
            cursor: pointer;
            touch-action: none;
          }
          input[type="range"].env-alloc-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 22px;
            height: 22px;
            border-radius: 50%;
            background: var(--slider-color);
            border: 3px solid #0D0D0D;
            box-shadow: 0 0 0 2px var(--slider-color);
            cursor: grab;
            margin-top: -8px;
          }
          input[type="range"].env-alloc-slider::-webkit-slider-thumb:active {
            cursor: grabbing;
            transform: scale(1.15);
          }
          input[type="range"].env-alloc-slider::-moz-range-thumb {
            width: 22px;
            height: 22px;
            border-radius: 50%;
            background: var(--slider-color);
            border: 3px solid #0D0D0D;
            box-shadow: 0 0 0 2px var(--slider-color);
            cursor: grab;
          }
          input[type="range"].env-alloc-slider::-webkit-slider-runnable-track {
            height: 6px;
            border-radius: 3px;
            background: linear-gradient(
              to right,
              var(--slider-color) 0%,
              var(--slider-color) var(--slider-pct),
              #1F1F1F var(--slider-pct),
              #1F1F1F 100%
            );
          }
          input[type="range"].env-alloc-slider::-moz-range-track {
            height: 6px;
            border-radius: 3px;
            background: #1F1F1F;
          }
          input[type="range"].env-alloc-slider::-moz-range-progress {
            height: 6px;
            border-radius: 3px;
            background: var(--slider-color);
          }
        `}</style>

        {!mergeHintDismissed && activeEnvelopes.length > 10 && (
          <div className="flex items-start gap-3 p-3 rounded-xl bg-[#3B82F6]/10 border border-[#3B82F6]/20">
            <Info className="h-4 w-4 text-[#3B82F6] shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1 flex-1 min-w-0">
              <p className="text-sm text-[#93C5FD] leading-snug">
                You have {activeEnvelopes.length} envelopes. Consider merging similar ones to simplify your budget.
              </p>
              <button
                type="button"
                onClick={() => { dismissMergeHint(); navigateTo("envelopes") }}
                className="self-start text-xs font-medium text-[#3B82F6] hover:text-[#60A5FA] underline underline-offset-2 transition-colors"
              >
                Merge envelopes
              </button>
            </div>
            <button
              type="button"
              onClick={dismissMergeHint}
              className="text-[#3B82F6]/60 hover:text-[#3B82F6] transition-colors shrink-0"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="flex min-w-0 flex-col max-md:max-h-[calc(100dvh-13rem)] max-md:overflow-x-hidden max-md:overflow-y-auto max-md:overscroll-y-contain max-md:touch-pan-y max-md:[-webkit-overflow-scrolling:touch]">
          {showAllocStackBar && (
            <div className="sticky top-0 z-20 -mx-4 px-4 md:-mx-6 md:px-6 py-3 -mt-2 mb-2 bg-[#0D0D0D] border-b border-[#1F1F1F] shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
              <div className="flex flex-col gap-2 min-w-0">
                <AllocationStackedBar
                  envelopes={allocBarSegments}
                  savingsValue={draftSavings}
                  totalValue={state.monthlyIncome}
                  onSegmentClick={(envelopeId) => {
                    setActiveSliderEnvId(envelopeId)
                    sliderRowRefs.current[envelopeId]?.scrollIntoView({ behavior: "smooth", block: "center" })
                  }}
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground px-1 tabular-nums">
                  <span>{formatUsd(draftTotalAllocated)} allocated</span>
                  <span>{formatUsd(state.monthlyIncome)} income</span>
                </div>
              </div>
            </div>
          )}

          {/* Per-envelope slider rows */}
          <div className="flex min-w-0 flex-col gap-3 max-md:space-y-1">
            {activeEnvelopes.map((env) => {
              const val = getDraft(env.id, env.monthlyAllotment)
              const sliderMax = roundMoneyCents(val + draftSavings)
              const pct = state.monthlyIncome > 0 ? Math.round((val / state.monthlyIncome) * 100) : 0
              const rangeDisplayValue = snapSliderDisplayValue(val, sliderMax, ALLOCATION_SLIDER_STEP)
              const sliderPct = sliderMax > 0 ? (rangeDisplayValue / sliderMax) * 100 : 0
              const amountDisplay =
                focusedAmountEnvId === env.id
                  ? (textDrafts[env.id] ?? formatAllotmentInputDisplay(val))
                  : formatAllotmentInputDisplay(val)

              return (
                <div
                  key={env.id}
                  ref={el => { sliderRowRefs.current[env.id] = el }}
                  className={`flex min-w-0 flex-col gap-2 p-3 rounded-xl transition-colors ${
                    activeSliderEnvId === env.id ? "bg-[#1A1A1A]" : "bg-transparent"
                  }`}
                  onClick={() => setActiveSliderEnvId(env.id)}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${env.color}22` }}
                    >
                      <EnvelopeIconDisplay
                        icon={env.icon}
                        fallbackName={env.name}
                        className="h-4 w-4 text-[10px]"
                        style={{ color: env.color }}
                      />
                    </div>
                    <span className="flex-1 text-sm font-medium text-foreground truncate min-w-0">{env.name}</span>
                    <div className="flex items-baseline gap-1.5 shrink-0">
                      <span className="text-xs text-muted-foreground">$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={amountDisplay}
                        onChange={e => {
                          const raw = e.target.value
                          setTextDrafts(prev => ({ ...prev, [env.id]: raw }))
                          const parsed = parsePartialMoneyInput(raw)
                          if (parsed !== null) {
                            setDraft(env.id, Math.min(sliderMax, Math.max(0, parsed)))
                          }
                        }}
                        onFocus={() => {
                          setFocusedAmountEnvId(env.id)
                          setActiveSliderEnvId(env.id)
                          setTextDrafts(prev => ({
                            ...prev,
                            [env.id]: formatAllotmentInputDisplay(val),
                          }))
                        }}
                        onBlur={() => {
                          const committed = monthlyFromMoneyInput(
                            textDrafts[env.id] ?? formatAllotmentInputDisplay(val),
                            sliderMax,
                          )
                          setDraft(env.id, committed)
                          setFocusedAmountEnvId(null)
                          clearTextDraft(env.id)
                        }}
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            e.currentTarget.blur()
                          }
                        }}
                        placeholder="0"
                        aria-label={`${env.name} monthly allotment amount`}
                        className="w-24 bg-transparent border-b border-[#333] text-right text-foreground text-sm font-semibold py-0.5 focus:outline-none focus:border-[#F7931A] transition-colors"
                      />
                      <span className="text-xs text-muted-foreground w-10 text-right">{pct}%</span>
                    </div>
                  </div>

                  <div className="flex min-w-0 items-center gap-2">
                    <input
                      type="range"
                      className="env-alloc-slider min-w-0 flex-1"
                      min={0}
                      max={sliderMax}
                      step={ALLOCATION_SLIDER_STEP}
                      value={rangeDisplayValue}
                      aria-label={`${env.name} monthly allotment`}
                      onChange={e => {
                        const v = parseFloat(e.target.value) || 0
                        setDraft(env.id, v)
                        if (focusedAmountEnvId === env.id) {
                          clearTextDraft(env.id)
                        }
                      }}
                      onFocus={() => setActiveSliderEnvId(env.id)}
                      style={{
                        "--slider-color": env.color,
                        "--slider-pct": `${sliderPct}%`,
                      } as React.CSSProperties}
                    />
                    <OnboardingAllocFineScroller
                      accentColor={env.color}
                      ariaLabel={`Fine adjust ${env.name} monthly allotment`}
                      value={val}
                      maxValue={sliderMax}
                      onGestureStart={() => setActiveSliderEnvId(env.id)}
                      onNudge={deltaSteps => {
                        const next = nudgeOnboardingAllocationAmount(
                          getDraft(env.id, env.monthlyAllotment),
                          deltaSteps,
                          sliderMax,
                          ONBOARDING_ALLOCATE_FINE_STEP,
                        )
                        setDraft(env.id, next)
                        if (focusedAmountEnvId === env.id) {
                          clearTextDraft(env.id)
                        }
                      }}
                      onGestureEnd={() => {}}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Savings row */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-[#1A1A1A]/60 border border-[#1F1F1F]">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-[#22C55E]/10">
            <PiggyBank className="h-4 w-4 text-[#22C55E]" />
          </div>
          <span className="flex-1 text-sm font-medium text-muted-foreground">Savings</span>
          <div className="flex items-baseline gap-1.5 shrink-0">
            <span className="text-sm font-semibold text-[#22C55E]">{formatUsd(draftSavings)}</span>
            <span className="text-xs text-muted-foreground w-10 text-right">{draftSavingsPct}%</span>
          </div>
        </div>

        {draftSavings === 0 && draftTotalAllocated > 0 && (
          <p className="text-xs text-amber-400/80 text-center">All income allocated — nothing goes to savings</p>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleCancel}
            className="flex-1 py-2.5 bg-[#1A1A1A] text-foreground rounded-xl font-medium text-sm hover:bg-[#222] transition-colors border border-[#333]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 py-2.5 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-medium text-sm hover:bg-[#F7931A]/90 transition-colors flex items-center justify-center gap-1.5"
          >
            <Check className="h-4 w-4" /> Save Allocations
          </button>
        </div>
      </div>
    </div>
    <RetroMissedPaycheckDialog
      open={retroDialogOpen}
      onOpenChange={handleRetroDialogOpenChange}
      previewGrossUsd={retroPreviewGross}
    />
    </>
  )
}
