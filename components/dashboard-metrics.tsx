"use client"

import { DollarSign, TrendingDown, Bitcoin, Zap } from 'lucide-react'
import { useApp } from "@/lib/app-context"
import { getCurrentBtcPrice, getCurrentMonthKey, formatUsd, formatNumber, satsPerDollar } from "@/lib/data"

export function DashboardMetrics() {
  const { state } = useApp()

  const currentMonth = getCurrentMonthKey()
  const currentBtcPrice = getCurrentBtcPrice()
  const currentSatsPerDollar = satsPerDollar(currentBtcPrice)

  const monthlySpend = state.transactions
    .filter((t) => t.type === "expense" && t.date.startsWith(currentMonth))
    .reduce((sum, t) => sum + t.amount, 0)

  const metrics = [
    {
      label: "Monthly Income",
      value: formatUsd(state.monthlyIncome),
      icon: DollarSign,
      color: "#22C55E",
    },
    {
      label: "Monthly Spend",
      value: formatUsd(monthlySpend),
      icon: TrendingDown,
      color: "#F7931A",
    },
    {
      label: "BTC Price",
      value: formatUsd(currentBtcPrice),
      icon: Bitcoin,
      color: "#F7931A",
    },
    {
      label: "Sats per Dollar",
      value: formatNumber(currentSatsPerDollar),
      icon: Zap,
      color: "#EAB308",
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {metrics.map((metric) => {
        const Icon = metric.icon
        return (
          <div key={metric.label} className="flex flex-col gap-3 p-5 bg-[#0D0D0D] rounded-2xl">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg" style={{ backgroundColor: `${metric.color}15` }}>
                <Icon className="h-4 w-4" style={{ color: metric.color }} />
              </div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">{metric.label}</span>
            </div>
            <span className="text-2xl lg:text-3xl font-bold text-foreground">{metric.value}</span>
          </div>
        )
      })}
    </div>
  )
}
