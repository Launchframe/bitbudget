"use client"

import { useMemo, useState } from "react"
import { useApp } from "@/lib/app-context"
import { formatUsd, getEnvelopeBalanceAllTime } from "@/lib/data"
import { EnvelopeIconDisplay } from "@/components/envelope-icon-display"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { applyBalancedSliderChange } from "@/lib/rebalance-math"

const SLIDER_STEP = 0.01

export function EnvelopeFundSliders({
  mode,
  grossUsd,
  valuesByEnvelopeId,
  manuallySetEnvelopes,
  onChange,
  onManualTouch,
  moveCreditMultiplier = 10,
  rebalanceMode = "independent",
  fundFromSavings = false,
  savingsBalance = 0,
  /** When false, envelope rows grow with the parent scroll area (e.g. rebalance dialog). */
  scrollEnvelopeList = true,
}: {
  mode: "move" | "income"
  grossUsd: number
  valuesByEnvelopeId: Record<string, number>
  manuallySetEnvelopes: ReadonlySet<string>
  onChange: (envelopeId: string, amountUsd: number) => void
  onManualTouch: (envelopeId: string) => void
  moveCreditMultiplier?: number
  rebalanceMode?: "balanced" | "independent"
  fundFromSavings?: boolean
  /** Remaining Savings available for credits (Fund from Savings). */
  savingsBalance?: number
  scrollEnvelopeList?: boolean
}) {
  const { discretionaryEnvelopes, activeTransactions } = useApp()

  const envelopeIds = useMemo(
    () => discretionaryEnvelopes.map((e) => e.id),
    [discretionaryEnvelopes],
  )

  const limitsById = useMemo(() => {
    const map = new Map<string, { maxDebit: number; maxCredit: number; currentBalance: number }>()
    for (const env of discretionaryEnvelopes) {
      const currentBalance = getEnvelopeBalanceAllTime(activeTransactions, env.id)
      const maxCredit =
        mode === "income"
          ? Math.max(0, grossUsd)
          : Math.max(0, env.monthlyAllotment * moveCreditMultiplier)
      map.set(env.id, {
        currentBalance,
        maxDebit: Math.max(0, currentBalance),
        maxCredit,
      })
    }
    return map
  }, [discretionaryEnvelopes, activeTransactions, mode, grossUsd, moveCreditMultiplier])

  const runningTotal = useMemo(() => {
    return Object.values(valuesByEnvelopeId).reduce(
      (s, v) => s + (Number.isFinite(v) && v > 0 ? v : 0),
      0,
    )
  }, [valuesByEnvelopeId])

  const savingsNet = useMemo(() => {
    if (mode !== "move" || rebalanceMode !== "independent") return 0
    return Object.entries(valuesByEnvelopeId).reduce((s, [, v]) => {
      if (!Number.isFinite(v)) return s
      return s - v
    }, 0)
  }, [mode, rebalanceMode, valuesByEnvelopeId])

  const totalPositiveCredits = useMemo(() => {
    return Object.values(valuesByEnvelopeId).reduce(
      (s, v) => s + (Number.isFinite(v) && v > 0 ? v : 0),
      0,
    )
  }, [valuesByEnvelopeId])

  const incomeCap = Math.max(0, grossUsd)
  const overIncome = mode === "income" && runningTotal > incomeCap + 0.015
  void manuallySetEnvelopes

  const [preciseIds, setPreciseIds] = useState<Set<string>>(() => new Set())
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({})

  function enterPreciseMode(envelopeId: string, current: number) {
    setPreciseIds((prev) => new Set(prev).add(envelopeId))
    setAmountDrafts((prev) => ({
      ...prev,
      [envelopeId]: Math.abs(current) > 0.005 ? String(Math.round(current * 100) / 100) : "",
    }))
  }

  function exitPreciseMode(envelopeId: string) {
    setPreciseIds((prev) => {
      const next = new Set(prev)
      next.delete(envelopeId)
      return next
    })
    setAmountDrafts((prev) => {
      if (!(envelopeId in prev)) return prev
      const next = { ...prev }
      delete next[envelopeId]
      return next
    })
  }

  function commitPreciseAmount(envelopeId: string, min: number, max: number) {
    const parsed = parseFloat(amountDrafts[envelopeId] ?? "")
    const clamped = Number.isFinite(parsed)
      ? Math.round(Math.min(max, Math.max(min, parsed)) * 100) / 100
      : 0
    handleSliderChange(envelopeId, clamped)
    exitPreciseMode(envelopeId)
  }

  function handleSliderChange(envelopeId: string, raw: number) {
    onManualTouch(envelopeId)
    if (mode === "move" && rebalanceMode === "balanced" && !fundFromSavings) {
      const next = applyBalancedSliderChange(
        envelopeId,
        raw,
        valuesByEnvelopeId,
        envelopeIds,
        limitsById,
      )
      for (const id of envelopeIds) {
        onChange(id, next[id] ?? 0)
      }
      return
    }
    onChange(envelopeId, raw)
  }

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {mode === "income" ? (
        <p
          className={`text-xs ${overIncome ? "text-destructive" : "text-muted-foreground"}`}
          role={overIncome ? "alert" : undefined}
        >
          Assigned: {formatUsd(runningTotal, 2)} of {formatUsd(incomeCap, 2)}
        </p>
      ) : null}

      {mode === "move" && rebalanceMode === "independent" ? (
        <p className="text-xs text-muted-foreground" role="status">
          {Math.abs(savingsNet) <= 0.005 ? (
            "Savings will stay the same"
          ) : (
            <>
              Savings will {savingsNet > 0 ? "increase" : "decrease"} by{" "}
              {formatUsd(Math.abs(savingsNet), 2)}
              {savingsNet > 0 ? " (money from envelopes)" : " (money into envelopes)"}
            </>
          )}
        </p>
      ) : null}

      <div
        className={cn(
          "flex flex-col gap-3 min-w-0",
          scrollEnvelopeList && "max-h-[36vh] overflow-y-auto",
        )}
      >
        {discretionaryEnvelopes.map((env) => {
          const lim = limitsById.get(env.id) ?? { maxDebit: 0, maxCredit: 0, currentBalance: 0 }
          const raw = valuesByEnvelopeId[env.id] ?? 0
          const canDebit = lim.maxDebit > 0.005
          const maxCredit = lim.maxCredit
          const positiveRaw = Math.max(0, raw)
          const otherPositive = totalPositiveCredits - positiveRaw
          const savingsHeadroom = Math.max(
            0,
            Math.round((Math.max(0, savingsBalance) - otherPositive) * 100) / 100,
          )
          const min =
            mode === "move" && !fundFromSavings && canDebit ? -lim.maxDebit : 0
          const max =
            mode === "move" && fundFromSavings
              ? maxCredit > 0.005
                ? Math.min(maxCredit, savingsHeadroom)
                : savingsHeadroom
              : maxCredit
          const value =
            mode === "income"
              ? Math.max(0, Math.min(max, raw))
              : fundFromSavings
                ? Math.max(0, Math.min(max, raw))
                : canDebit
                  ? Math.min(max, Math.max(min, raw))
                  : Math.max(0, Math.min(max, raw))

          const sliderLocked =
            mode === "move" && !fundFromSavings && !canDebit && value <= 0.005
          const sliderDisabled = sliderLocked || max <= 0.005
          const isPrecise = preciseIds.has(env.id)
          const sliderMax = Math.max(min, max)

          return (
            <div
              key={env.id}
              className={cn(
                "rounded-xl border p-3 min-w-0",
                sliderLocked ? "border-[#444] opacity-90" : "border-[#333]",
              )}
              data-envelope-slider={env.id}
            >
              <div className="flex items-center gap-2 mb-2 min-w-0">
                <EnvelopeIconDisplay icon={env.icon} fallbackName={env.name} className="h-5 w-5 shrink-0" />
                <span className="text-sm font-medium truncate">{env.name}</span>
                <span className="text-xs text-muted-foreground ml-auto shrink-0">
                  Balance {formatUsd(lim.currentBalance)}
                </span>
              </div>
              {lim.currentBalance < -0.005 ? (
                <p className="text-xs text-amber-400/95 mb-1">
                  Currently in deficit: {formatUsd(lim.currentBalance)}
                </p>
              ) : null}
              {sliderLocked ? (
                <p className="text-xs text-muted-foreground mb-2">
                  There isn&apos;t any money in {env.name} to move out.
                </p>
              ) : null}
              {fundFromSavings && max <= 0.005 ? (
                <p className="text-xs text-muted-foreground mb-2">
                  {savingsHeadroom <= 0.005 && totalPositiveCredits > 0.005
                    ? "All available Savings is already assigned above."
                    : "No Savings available to move into this envelope."}
                </p>
              ) : null}
              <Label className="text-xs">
                {mode === "income" ? "Add to envelope" : fundFromSavings ? "Add from Savings" : "Change (+/−)"}
              </Label>
              <div className="flex items-stretch gap-0 min-w-0 -mx-1">
                <div className="flex-1 min-w-0 px-1">
                  {isPrecise ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-muted-foreground shrink-0" aria-hidden>
                        $
                      </span>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min={min}
                        max={sliderMax}
                        value={amountDrafts[env.id] ?? ""}
                        disabled={sliderDisabled}
                        autoFocus
                        aria-label={
                          mode === "income"
                            ? `Exact amount to add to ${env.name}`
                            : fundFromSavings
                              ? `Exact amount from Savings for ${env.name}`
                              : `Exact change for ${env.name}`
                        }
                        onChange={(e) =>
                          setAmountDrafts((prev) => ({ ...prev, [env.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault()
                            commitPreciseAmount(env.id, min, sliderMax)
                          }
                          if (e.key === "Escape") {
                            e.preventDefault()
                            exitPreciseMode(env.id)
                          }
                        }}
                        onBlur={() => commitPreciseAmount(env.id, min, sliderMax)}
                        className="h-9 bg-[#1A1A1A] border-[#333] text-foreground font-mono tabular-nums"
                      />
                    </div>
                  ) : (
                    <input
                      type="range"
                      min={min}
                      max={sliderMax}
                      step={SLIDER_STEP}
                      value={value}
                      disabled={sliderDisabled}
                      aria-disabled={sliderDisabled}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value)
                        handleSliderChange(env.id, Number.isFinite(v) ? v : 0)
                      }}
                      className={cn("w-full min-w-0", sliderDisabled && "opacity-50")}
                    />
                  )}
                </div>
                {isPrecise ? (
                  <button
                    type="button"
                    className="shrink-0 min-w-[4.25rem] border-l border-[#444] pl-2 pr-1 flex flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-[#1A1A1A]/80 rounded-r-lg transition-colors disabled:opacity-50"
                    disabled={sliderDisabled}
                    onClick={() => exitPreciseMode(env.id)}
                    aria-label={`Use slider for ${env.name}`}
                  >
                    Slider
                  </button>
                ) : (
                  <button
                    type="button"
                    className="shrink-0 min-w-[4.25rem] border-l border-[#444] pl-2 pr-1 -mt-2 flex flex-col items-end justify-center gap-0.5 hover:bg-[#1A1A1A]/80 rounded-r-lg transition-colors disabled:opacity-50 disabled:pointer-events-none"
                    disabled={sliderDisabled}
                    onClick={() => enterPreciseMode(env.id, value)}
                    aria-label={`Type exact amount for ${env.name}`}
                  >
                    <span className="text-[10px] leading-none text-muted-foreground">Exact</span>
                    <span className="text-xs font-mono tabular-nums text-foreground">
                      {formatUsd(value, 2)}
                    </span>
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
