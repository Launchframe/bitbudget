"use client"

import type { BtcDisplayUnit } from "@/lib/data"
import {
  formatBtcAmount,
  formatBtcAmountFromSats,
  formatSatsInteger,
  SATS_PER_BTC,
} from "@/lib/data"
import { SatSymbol } from "@/components/sat-symbol"
import { cn } from "@/lib/utils"

/** Renders BTC (₿ prefix) or sats (custom sat symbol + value + “sats”) for UI. */
export function FormattedBtcAmount({
  btcValue,
  unit,
  displayUnit = true,
  className,
}: {
  btcValue: number
  unit: BtcDisplayUnit
  displayUnit?: boolean
  className?: string
}) {
  if (unit === "btc") {
    return (
      <span className={cn("font-ibm-plex-mono tabular-nums", className)}>
        {formatBtcAmount(btcValue, "btc", displayUnit)}
      </span>
    )
  }
  const sats = Math.round(btcValue * SATS_PER_BTC)
  const num = formatSatsInteger(sats)
  if (!displayUnit) {
    return <span className={cn("tabular-nums", className)}>{num}</span>
  }
  return (
    <span className={cn("inline-flex items-center gap-x-1 tabular-nums", className)}>
      <SatSymbol className="h-[0.95em] w-[0.74em] shrink-0 self-center text-current" />
      <span>{num}</span>
    </span>
  )
}

/** Same as {@link FormattedBtcAmount} but input is an integer sat count. */
export function FormattedBtcAmountFromSats({
  sats,
  unit,
  displayUnit = true,
  className,
}: {
  sats: number
  unit: BtcDisplayUnit
  displayUnit?: boolean
  className?: string
}) {
  if (unit === "btc") {
    return (
      <span className={cn("font-ibm-plex-mono tabular-nums", className)}>
        {formatBtcAmountFromSats(sats, "btc", displayUnit)}
      </span>
    )
  }
  const num = formatSatsInteger(sats)
  if (!displayUnit) {
    return <span className={cn("tabular-nums", className)}>{num}</span>
  }
  return (
    <span className={cn("inline-flex items-center gap-x-1 tabular-nums", className)}>
      <SatSymbol className="h-[0.95em] w-[0.74em] shrink-0 self-center text-current" />
      <span>{num}</span>
    </span>
  )
}
