"use client"

import { TrendingDown, TrendingUp } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Compact % change pill (orange / up vs green / down) for BTC value vs spend.
 * {@link percentChange} is the absolute magnitude (e.g. |multiplier − 1| × 100).
 */
export function PriceGainLossBadge({
  gained,
  percentChange,
  className,
  decimalPlaces = 0,
}: {
  gained: boolean
  percentChange: number
  className?: string
  /** Passed to {@link Number.toFixed} for the percentage digits. */
  decimalPlaces?: number
}) {
  const pct = Number.isFinite(percentChange) ? Math.max(0, percentChange) : 0
  const label = `${gained ? "+" : "-"}${pct.toFixed(decimalPlaces)}%`

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full",
        gained ? "text-[#F7931A] bg-[#F7931A]/10" : "text-[#22C55E] bg-[#22C55E]/10",
        className,
      )}
      aria-label={gained ? `BTC value up ${label} vs spend` : `BTC value down ${label} vs spend`}
    >
      {gained ? <TrendingUp className="h-3 w-3 shrink-0" aria-hidden /> : <TrendingDown className="h-3 w-3 shrink-0" aria-hidden />}
      <span>{label}</span>
    </span>
  )
}
