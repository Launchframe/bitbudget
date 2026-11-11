"use client"

import { useApp } from "@/lib/app-context"
import { getCurrentMonthKey } from "@/lib/data"
import { useRunway } from "@/lib/use-runway"
import {
  checkupMonthName,
  gapSummaryLine,
  isCheckupReady,
  isRunwayConfigured,
} from "@/lib/runway-ui"
import { ArrowRight, CalendarCheck, Plane } from "lucide-react"

/**
 * Compact dashboard entry point into Runway. Phones reach Runway through this
 * card (no bottom-nav item); desktop shows the same card alongside the sidebar
 * link. Rendered only when opportunity-cost (bitcoin) features are on.
 */
export function RunwayDashboardCard() {
  const { navigateTo } = useApp()
  const { plan, loading, compute } = useRunway({ withLoans: false })

  const monthKey = getCurrentMonthKey()
  const configured = isRunwayConfigured(plan)
  const checkupReady = isCheckupReady(plan, monthKey)

  // Keep the card height stable across its states to avoid dashboard layout
  // jump. A reserved min-height on the text column keeps the loading skeleton,
  // the gap line, and the checkup variant the same height.
  const shell =
    "group w-full text-left flex items-center gap-4 p-4 md:p-5 bg-[#0D0D0D] rounded-2xl border transition-colors min-w-0"
  // A ready checkup gets an accent border so it reads as actionable at a glance
  // in the dense dashboard grid; otherwise the card stays visually quiet.
  const borderClass = checkupReady
    ? "border-[#F7931A]/40 hover:border-[#F7931A]/70"
    : "border-[#1F1F1F] hover:border-[#F7931A]/50"
  const textCol = "flex flex-col gap-0.5 min-w-0 flex-1 min-h-[2.5rem] justify-center"

  if (loading) {
    return (
      <div className={`${shell} border-[#1F1F1F]`} aria-hidden>
        <div className="p-2.5 rounded-xl bg-[#F7931A]/10 shrink-0">
          <Plane className="h-5 w-5 text-[#F7931A]" />
        </div>
        <div className={`${textCol} gap-2`}>
          <div className="h-3 w-20 rounded bg-[#1A1A1A]" />
          <div className="h-3 w-48 max-w-full rounded bg-[#1A1A1A]" />
        </div>
      </div>
    )
  }

  let title: string
  let detail: string
  if (!configured) {
    title = "Plan your runway"
    detail = "Map how long your money lasts if you stop earning."
  } else {
    const comp = compute("none")
    title = "Runway"
    detail = comp
      ? gapSummaryLine(comp.gap.flat.cashGapUsd, comp.gap.flat.bitcoinGapUsd)
      : "Open your runway to see where you stand."
  }

  return (
    <button
      type="button"
      onClick={() => navigateTo("runway")}
      className={`${shell} ${borderClass}`}
      aria-label={
        checkupReady
          ? `Open your runway — ${checkupMonthName(monthKey)} checkup ready`
          : configured
            ? "Open your runway"
            : "Set up your runway"
      }
    >
      <div className="p-2.5 rounded-xl bg-[#F7931A]/10 shrink-0">
        <Plane className="h-5 w-5 text-[#F7931A]" aria-hidden />
      </div>
      <div className={textCol}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">
            {title}
          </span>
          {checkupReady && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#F7931A]/15 text-[#F7931A]">
              <CalendarCheck className="h-3 w-3" aria-hidden />
              {checkupMonthName(monthKey)} checkup ready
            </span>
          )}
        </div>
        <span className="text-sm text-foreground truncate">{detail}</span>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 group-hover:text-[#F7931A] transition-colors" aria-hidden />
    </button>
  )
}
