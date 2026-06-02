"use client"

import { formatUsd } from "@/lib/data"
import {
  SAVINGS_DRAW_WARN_RATIO_HIGH,
  SAVINGS_DRAW_WARN_RATIO_LOW,
} from "@/lib/constants"
import { cn } from "@/lib/utils"

/** Ticker-style headline for “all in Savings” option (percent vs dollars). */
export function SavingsOptionHeadline({
  depositUsd,
  monthlyIncomeUsd,
  className,
}: {
  depositUsd: number
  monthlyIncomeUsd: number
  className?: string
}) {
  const dep = Number.isFinite(depositUsd) ? Math.max(0, depositUsd) : 0
  const mi = Number.isFinite(monthlyIncomeUsd) ? Math.max(0, monthlyIncomeUsd) : 0
  const pct = mi > 0.005 ? (dep / mi) * 100 : null
  const usePct = pct != null && pct >= 5
  const text = usePct ? `+${Math.round(pct)}%` : `+${formatUsd(dep, 2)}`
  return (
    <span
      className={cn(
        "font-mono text-sm font-semibold tabular-nums text-[#22C55E]",
        className,
      )}
      aria-hidden
    >
      {text}
    </span>
  )
}

const EPS = 0.005

export function savingsDrawRatioTitle(drawUsd: number, savingsBalanceUsd: number): string {
  const d = Math.max(0, drawUsd)
  const b = Math.max(0, savingsBalanceUsd)
  if (d <= EPS) return "No draw from Savings in this step."
  if (b <= EPS) return "Draw from Savings compared to a zero Savings balance."
  const r = d / b
  if (r < SAVINGS_DRAW_WARN_RATIO_LOW) return "Uses under a quarter of your current Savings balance."
  if (r < SAVINGS_DRAW_WARN_RATIO_HIGH) return "Uses a moderate share of your current Savings balance."
  return "Uses a large share of your current Savings balance."
}

function drawAmountClass(drawUsd: number, savingsBalanceUsd: number): string {
  const d = Math.max(0, drawUsd)
  const b = Math.max(0, savingsBalanceUsd)
  if (d <= EPS) return "text-muted-foreground"
  if (b <= EPS) return "text-red-500"
  const r = d / b
  if (r < SAVINGS_DRAW_WARN_RATIO_LOW) return "text-[#22C55E]"
  if (r < SAVINGS_DRAW_WARN_RATIO_HIGH) return "text-[#F7931A]"
  return "text-red-500"
}

/**
 * Stable strip: draw from Savings (D) vs Savings balance (B), with ratio-based color on D.
 * Rebalance mode adds into-Savings surplus copy and a mixed second line when applicable.
 */
export function SavingsDrawdownSummary({
  drawFromSavingsUsd,
  savingsBalanceUsd,
  intoSavingsUsd = 0,
  showRebalanceExtras = false,
  className,
}: {
  drawFromSavingsUsd: number
  savingsBalanceUsd: number
  intoSavingsUsd?: number
  showRebalanceExtras?: boolean
  className?: string
}) {
  const D = Math.max(0, drawFromSavingsUsd)
  const B = Math.max(0, savingsBalanceUsd)
  const into = Math.max(0, intoSavingsUsd)
  const drawTitle = savingsDrawRatioTitle(D, B)
  const drawClass = drawAmountClass(D, B)

  const surplusOnly = showRebalanceExtras && D <= EPS && into > EPS
  const mixed = showRebalanceExtras && D > EPS && into > EPS
  const surplusPct =
    surplusOnly && B > EPS ? Math.min(999, Math.round((into / B) * 100)) : null

  return (
    <div
      className={cn(
        "flex min-h-12 flex-col justify-center gap-0.5 rounded-lg border border-[#333]/80 bg-[#111]/80 px-3 py-2 text-xs",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {surplusOnly ? (
        <p className="text-muted-foreground leading-snug">
          {surplusPct != null ? (
            <>
              You&apos;re adding about <span className="text-foreground font-medium">{surplusPct}%</span> to
              your Savings.
            </>
          ) : (
            <>
              Adding <span className="text-foreground font-medium">{formatUsd(into, 2)}</span> to Savings.
            </>
          )}
        </p>
      ) : (
        <p className="font-mono tabular-nums text-[13px] leading-snug">
          <span className={cn("font-medium", drawClass)} title={drawTitle}>
            {formatUsd(D, 2)}
          </span>
          <span className="text-muted-foreground"> / </span>
          <span className="text-muted-foreground">{formatUsd(B, 2)}</span>
          <span className="text-muted-foreground font-sans text-[11px] font-normal ml-1.5">
            from Savings
          </span>
        </p>
      )}

      {mixed ? (
        <p className="text-[11px] text-muted-foreground leading-snug">
          Also moving {formatUsd(into, 2)} back to Savings.
        </p>
      ) : null}
    </div>
  )
}
