"use client"

import { useState, useMemo, useRef } from "react"
import { useApp } from "@/lib/app-context"
import { formatUsd } from "@/lib/data"
import { Input } from "@/components/ui/input"
import { Check, Info, X, PiggyBank } from "lucide-react"
import { getEnvelopeIcon } from "@/lib/envelope-icons"

/** Draft value for an envelope: user override or current allotment. Avoids syncing state in useEffect. */
function useDraftAllotments() {
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const getDraft = (envId: string, base: number) => overrides[envId] ?? base
  const setDraft = (envId: string, value: number) =>
    setOverrides(prev => ({ ...prev, [envId]: value }))
  return { getDraft, setDraft }
}

const ALLOCATION_SLIDER_STEP = 5

/** Align range input value to step so browsers don’t clamp unpredictably when draft ≠ multiple of step. */
function snapSliderDisplayValue(value: number, max: number, step: number): number {
  const snapped = Math.round(value / step) * step
  return Math.min(max, Math.max(0, snapped))
}

export function EnvelopeAllocationsPage() {
  const { state, navigateTo, editEnvelope, setMonthlyIncome } = useApp()
  const activeEnvelopes = useMemo(
    () => state.envelopes.filter(e => !e.archived),
    [state.envelopes]
  )
  const { getDraft, setDraft } = useDraftAllotments()
  const [activeSliderEnvId, setActiveSliderEnvId] = useState<string | null>(null)
  const [editingIncome, setEditingIncome] = useState(false)
  const [incomeValue, setIncomeValue] = useState("")
  const [mergeHintDismissed, setMergeHintDismissed] = useState(() => {
    try { return localStorage.getItem("bitbudget-merge-hint-dismissed") === "1" } catch { return false }
  })
  const sliderRowRefs = useRef<Record<string, HTMLDivElement | null>>({})

  function dismissMergeHint() {
    setMergeHintDismissed(true)
    try { localStorage.setItem("bitbudget-merge-hint-dismissed", "1") } catch {}
  }

  function handleCancel() {
    navigateTo("envelopes")
  }

  function handleSave() {
    for (const env of activeEnvelopes) {
      const newVal = getDraft(env.id, env.monthlyAllotment)
      if (newVal !== env.monthlyAllotment) {
        editEnvelope(env.id, { monthlyAllotment: newVal })
      }
    }
    navigateTo("envelopes")
  }

  const draftTotalAllocated = activeEnvelopes.reduce(
    (s, e) => s + getDraft(e.id, e.monthlyAllotment),
    0
  )
  const draftSavings = Math.max(0, state.monthlyIncome - draftTotalAllocated)
  const draftSavingsPct = state.monthlyIncome > 0 ? Math.round((draftSavings / state.monthlyIncome) * 100) : 0

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

        {/* Stacked bar */}
        <div className="flex flex-col gap-2">
          <div className="flex h-10 rounded-xl overflow-hidden bg-[#1A1A1A]">
            {activeEnvelopes.map((env) => {
              const val = getDraft(env.id, env.monthlyAllotment)
              if (val <= 0) return null
              const Icon = getEnvelopeIcon(env.icon)
              const pct = (val / state.monthlyIncome) * 100
              return (
                <button
                  key={env.id}
                  type="button"
                  onClick={() => {
                    setActiveSliderEnvId(env.id)
                    sliderRowRefs.current[env.id]?.scrollIntoView({ behavior: "smooth", block: "center" })
                  }}
                  className={`flex items-center justify-center relative ${
                    activeSliderEnvId === env.id ? "brightness-110" : "hover:brightness-110"
                  }`}
                  style={{
                    flex: `${val} 0 0px`,
                    backgroundColor: env.color,
                    minWidth: 4,
                  }}
                  title={`${env.name}: ${formatUsd(val)} (${Math.round(pct)}%)`}
                >
                  {pct > 8 && <Icon className="h-4 w-4 text-[#0D0D0D]/70" />}
                </button>
              )
            })}
            {draftSavings > 0 && (
              <div
                className="flex items-center justify-center"
                style={{ flex: `${draftSavings} 0 0px`, backgroundColor: "rgba(34, 197, 94, 0.25)", minWidth: 4 }}
                title={`Savings: ${formatUsd(draftSavings)} (${draftSavingsPct}%)`}
              >
                {draftSavingsPct > 8 && <PiggyBank className="h-4 w-4 text-[#22C55E]/60" />}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span>{formatUsd(draftTotalAllocated)} allocated</span>
            <span>{formatUsd(state.monthlyIncome)} income</span>
          </div>
        </div>

        {/* Per-envelope slider rows */}
        <div className="flex flex-col gap-3">
          {activeEnvelopes.map((env) => {
            const Icon = getEnvelopeIcon(env.icon)
            const val = getDraft(env.id, env.monthlyAllotment)
            const sliderMax = val + draftSavings
            const pct = state.monthlyIncome > 0 ? Math.round((val / state.monthlyIncome) * 100) : 0
            const rangeDisplayValue = snapSliderDisplayValue(val, sliderMax, ALLOCATION_SLIDER_STEP)
            const sliderPct = sliderMax > 0 ? (rangeDisplayValue / sliderMax) * 100 : 0

            return (
              <div
                key={env.id}
                ref={el => { sliderRowRefs.current[env.id] = el }}
                className={`flex flex-col gap-2 p-3 rounded-xl transition-colors ${
                  activeSliderEnvId === env.id ? "bg-[#1A1A1A]" : "bg-transparent"
                }`}
                onClick={() => setActiveSliderEnvId(env.id)}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${env.color}22` }}
                  >
                    <Icon className="h-4 w-4" style={{ color: env.color }} />
                  </div>
                  <span className="flex-1 text-sm font-medium text-foreground truncate">{env.name}</span>
                  <div className="flex items-baseline gap-1.5 shrink-0">
                    <span className="text-xs text-muted-foreground">$</span>
                    <input
                      type="number"
                      value={val || ""}
                      onChange={e => {
                        const raw = parseFloat(e.target.value)
                        const clamped = isNaN(raw) ? 0 : Math.min(Math.max(0, raw), sliderMax)
                        setDraft(env.id, clamped)
                      }}
                      placeholder="0"
                      min="0"
                      className="w-20 bg-transparent border-b border-[#333] text-right text-foreground text-sm font-semibold py-0.5 focus:outline-none focus:border-[#F7931A] transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <span className="text-xs text-muted-foreground w-10 text-right">{pct}%</span>
                  </div>
                </div>

                <input
                  type="range"
                  className="env-alloc-slider"
                  min={0}
                  max={sliderMax}
                  step={ALLOCATION_SLIDER_STEP}
                  value={rangeDisplayValue}
                  aria-label={`${env.name} monthly allotment`}
                  onChange={e => {
                    const v = parseInt(e.target.value, 10) || 0
                    setDraft(env.id, v)
                  }}
                  onFocus={() => setActiveSliderEnvId(env.id)}
                  style={{
                    "--slider-color": env.color,
                    "--slider-pct": `${sliderPct}%`,
                  } as React.CSSProperties}
                />
              </div>
            )
          })}
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
  )
}
