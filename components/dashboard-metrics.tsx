"use client"

import { DollarSign, TrendingDown, Bitcoin, Zap } from "lucide-react"
import { useApp } from "@/lib/app-context"
import { useBtcPrices } from "@/lib/btc-price-context"
import { getCurrentMonthKey, formatUsd, formatNumber } from "@/lib/data"

export function DashboardMetrics() {
  const { state, activeTransactions } = useApp()
  const { currentPrice, satsPerDollar } = useBtcPrices()
  const ocEnabled = state.opportunityCostEnabled

  const currentMonth = getCurrentMonthKey()

  const fundedIncomeMonth = activeTransactions
    .filter(
      (t) =>
        state.ledgerFundingEnabled &&
        !t.excludeFromMainHistory &&
        t.type === "credit" &&
        t.date.startsWith(currentMonth) &&
        (t.source === "paycheck" || t.source === "irregular_income"),
    )
    .reduce((sum, t) => sum + t.amount, 0)

  const displayedMonthlyIncome =
    state.ledgerFundingEnabled && fundedIncomeMonth > 0 ? fundedIncomeMonth : state.monthlyIncome

  const monthlySpend = activeTransactions
    .filter(
      (t) =>
        !t.excludeFromMainHistory &&
        t.type === "expense" &&
        t.date.startsWith(currentMonth),
    )
    .reduce((sum, t) => sum + t.amount, 0)

  const baseMetrics = [
    {
      label: "Monthly Income",
      value: formatUsd(displayedMonthlyIncome),
      icon: DollarSign,
      color: "#22C55E",
    },
    {
      label: "Monthly Spend",
      value: formatUsd(monthlySpend),
      icon: TrendingDown,
      color: "#F7931A",
    },
  ]

  const btcMetrics = [
    {
      label: "BTC Price",
      value: currentPrice ? formatUsd(currentPrice) : "—",
      icon: Bitcoin,
      color: "#F7931A",
    },
    {
      label: "Sats per Dollar",
      value: satsPerDollar ? formatNumber(satsPerDollar) : "—",
      icon: Zap,
      color: "#EAB308",
    },
  ]

  const metrics = ocEnabled ? [...baseMetrics, ...btcMetrics] : baseMetrics

  return (
    <div className={`grid gap-4 ${ocEnabled ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2"}`}>
      {metrics.map((metric) => {
        const Icon = metric.icon
        return (
          <div key={metric.label} className="flex flex-col gap-2 md:gap-3 p-3 md:p-5 bg-[#0D0D0D] rounded-2xl">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg" style={{ backgroundColor: `${metric.color}15` }}>
                <Icon className="h-4 w-4" style={{ color: metric.color }} />
              </div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">{metric.label}</span>
            </div>
            <span className="text-lg md:text-2xl lg:text-3xl font-bold text-foreground">{metric.value}</span>
          </div>
        )
      })}
    </div>
  )
}
