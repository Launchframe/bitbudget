"use client"

import { DollarSign, TrendingDown, PiggyBank, Wallet, Bitcoin, Zap } from "lucide-react"
import { useApp } from "@/lib/app-context"
import { useBtcPrices } from "@/lib/btc-price-context"
import { getCurrentMonthKey, formatUsd, formatNumber } from "@/lib/data"
import {
  SAVINGS_EXPERIENCE_DISMISSED,
  SAVINGS_GOLD_ACCENT,
} from "@/lib/constants"
import {
  findSavingsEnvelope,
  savingsBalance,
  sumMonthlyIncomeCredits,
  sumRemainingDiscretionary,
} from "@/lib/savings-ui-metrics"

export function DashboardMetrics() {
  const { state, activeTransactions, discretionaryEnvelopes } = useApp()
  const { currentPrice, satsPerDollar } = useBtcPrices()
  const ocEnabled = state.opportunityCostEnabled
  const savingsEngaged = state.savingsExperience !== SAVINGS_EXPERIENCE_DISMISSED

  const currentMonth = getCurrentMonthKey()

  const fundedIncomeMonth = sumMonthlyIncomeCredits(activeTransactions, currentMonth)

  const displayedMonthlyIncome =
    fundedIncomeMonth > 0 ? fundedIncomeMonth : state.monthlyIncome

  const monthlySpend = activeTransactions
    .filter(
      (t) =>
        !t.excludeFromMainHistory &&
        t.type === "expense" &&
        t.date.startsWith(currentMonth),
    )
    .reduce((sum, t) => sum + t.amount, 0)

  const remainingBalances = sumRemainingDiscretionary(
    activeTransactions,
    discretionaryEnvelopes,
  )

  const savingsEnvelope = findSavingsEnvelope(state.envelopes)
  const savingsBal = savingsBalance(activeTransactions, savingsEnvelope)

  const baseMetrics = savingsEngaged
    ? [
        {
          label: "Monthly Income",
          value: formatUsd(displayedMonthlyIncome),
          icon: DollarSign,
          color: "#22C55E",
        },
        {
          label: "Remaining",
          value: formatUsd(remainingBalances),
          icon: Wallet,
          color: "#3B82F6",
        },
        {
          label: "Savings",
          value: formatUsd(savingsBal),
          icon: PiggyBank,
          color: SAVINGS_GOLD_ACCENT,
        },
        {
          label: "Monthly Spend",
          value: formatUsd(monthlySpend),
          icon: TrendingDown,
          color: "#F7931A",
        },
      ]
    : [
        {
          label: "Monthly Income",
          value: formatUsd(displayedMonthlyIncome),
          icon: DollarSign,
          color: "#22C55E",
        },
        {
          label: "Remaining",
          value: formatUsd(remainingBalances),
          icon: Wallet,
          color: "#3B82F6",
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

  const primaryCount = baseMetrics.length

  return (
    <div className="flex flex-col gap-4">
      <div className={`grid gap-4 grid-cols-2 ${primaryCount >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        {baseMetrics.map((metric) => {
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

      {ocEnabled && (
        <div className="grid gap-4 grid-cols-2">
          {btcMetrics.map((metric) => {
            const Icon = metric.icon
            return (
              <div key={metric.label} className="flex flex-col gap-2 p-3 md:p-4 bg-[#0D0D0D]/80 rounded-2xl opacity-90">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg" style={{ backgroundColor: `${metric.color}10` }}>
                    <Icon className="h-3.5 w-3.5" style={{ color: metric.color }} />
                  </div>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{metric.label}</span>
                </div>
                <span className="text-base md:text-xl font-semibold text-foreground">{metric.value}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
