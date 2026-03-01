"use client"

import { useMemo } from "react"
import { useApp } from "@/lib/app-context"
import { useBtcPrices } from "@/lib/btc-price-context"
import { formatUsd } from "@/lib/data"
import { TrendingUp, TrendingDown } from "lucide-react"

export function TopOpportunityCosts() {
  const { state } = useApp()
  const { calculateOpportunityCost, currentPrice } = useBtcPrices()

  const topTransactions = useMemo(() => {
    return state.transactions
      .filter((t) => t.type === "expense")
      .map((t) => ({
        ...t,
        btcValueToday: calculateOpportunityCost(t.amount, t.date),
      }))
      .sort((a, b) => b.btcValueToday - a.btcValueToday)
      .slice(0, 10)
  }, [state.transactions, calculateOpportunityCost])

  return (
    <div className="bg-[#0D0D0D] rounded-2xl p-6">
      <div className="flex flex-col gap-1 mb-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Top Opportunity Costs</h2>
          <span className="text-xs text-muted-foreground uppercase tracking-wider">BTC what-if</span>
        </div>
        <p className="text-xs text-muted-foreground">
          What each expense would be worth today if you&apos;d bought BTC instead
          {currentPrice ? ` (BTC @ ${formatUsd(currentPrice)})` : ""}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-muted-foreground text-xs uppercase tracking-wider border-b border-[#1F1F1F]">
              <th className="pb-3 text-left font-medium pl-2 w-8">#</th>
              <th className="pb-3 text-left font-medium">Payee</th>
              <th className="pb-3 text-left font-medium hidden sm:table-cell">Date</th>
              <th className="pb-3 text-right font-medium">Spent</th>
              <th className="pb-3 text-right font-medium pr-2">BTC Value Today</th>
            </tr>
          </thead>
          <tbody>
            {topTransactions.map((txn, idx) => {
              const multiplier = txn.btcValueToday / txn.amount
              const gained = multiplier >= 1
              const pctChange = Math.abs((multiplier - 1) * 100)
              return (
                <tr key={txn.id} className="group hover:bg-[#1A1A1A] transition-colors">
                  <td className="py-3 pl-2 text-muted-foreground text-sm rounded-l-xl">{idx + 1}</td>
                  <td className="py-3">
                    <span className="font-medium text-foreground text-sm">{txn.payee}</span>
                  </td>
                  <td className="py-3 text-muted-foreground text-sm hidden sm:table-cell">
                    {new Date(txn.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                  <td className="py-3 text-right text-muted-foreground text-sm">
                    {formatUsd(txn.amount)}
                  </td>
                  <td className="py-3 text-right pr-2 rounded-r-xl">
                    <div className="flex items-center justify-end gap-2">
                      <span className={`text-sm font-semibold ${gained ? "text-[#F7931A]" : "text-[#22C55E]"}`}>
                        {formatUsd(txn.btcValueToday)}
                      </span>
                      {txn.btcValueToday > 0 && (
                        <span className={`flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                          gained
                            ? "text-[#F7931A] bg-[#F7931A]/10"
                            : "text-[#22C55E] bg-[#22C55E]/10"
                        }`}>
                          {gained ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {gained ? "+" : "-"}{pctChange.toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {topTransactions.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-muted-foreground text-sm">
                  No expense transactions yet. Add one to see opportunity costs.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
