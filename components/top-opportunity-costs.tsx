"use client"

import { useMemo, useState, useSyncExternalStore } from "react"
import { useApp } from "@/lib/app-context"
import { useBtcPrices } from "@/lib/btc-price-context"
import { formatUsd } from "@/lib/data"
import { FormattedBtcAmount } from "@/components/formatted-btc-sats-amount"
import { PriceGainLossBadge } from "@/components/price-gain-loss-badge"
import { TransactionDetailDialog } from "@/components/transaction-detail-dialog"
import { ENCRYPTED_DISPLAY } from "@/lib/encrypted-display"
import {
  getDashboardChartMode,
  subscribeDashboardChartMode,
} from "@/lib/dashboard-chart-mode"
import {
  getDashboardChartRange,
  subscribeDashboardChartRange,
  transactionInDashboardChartRange,
} from "@/lib/dashboard-chart-range"
import { isUserFacingExpense } from "@/lib/transaction-visibility"
import { SAVINGS_EXPERIENCE_DISMISSED, SAVINGS_GOLD_ACCENT } from "@/lib/constants"

import type { Transaction } from "@/lib/data"
import { formatTransactionTableDate } from "@/lib/transaction-dates"
import { findSavingsEnvelope, isSavingsInflowCredit } from "@/lib/savings-ui-metrics"

interface EnrichedTransaction extends Transaction {
  btcValueToday: number
  opportunityCost: number
  btcPriceAtTime: number
}

export function TopOpportunityCosts() {
  const { activeTransactions, state } = useApp()
  const { calculateOpportunityCost, getPriceOnDate, currentPrice } = useBtcPrices()
  const [selectedTxn, setSelectedTxn] = useState<EnrichedTransaction | null>(null)

  const chartMode = useSyncExternalStore(
    subscribeDashboardChartMode,
    getDashboardChartMode,
    () => "spending" as const,
  )
  const chartRange = useSyncExternalStore(
    subscribeDashboardChartRange,
    getDashboardChartRange,
    () => getDashboardChartRange(),
  )

  const rangeScopedTransactions = useMemo(
    () =>
      activeTransactions.filter((t) =>
        transactionInDashboardChartRange(t.date, chartRange),
      ),
    [activeTransactions, chartRange],
  )

  const savingsEnvelope = useMemo(
    () => findSavingsEnvelope(state.envelopes),
    [state.envelopes],
  )

  const savingsMode =
    state.opportunityCostEnabled &&
    chartMode === "savings" &&
    state.savingsExperience !== SAVINGS_EXPERIENCE_DISMISSED &&
    savingsEnvelope != null

  const rankedExpenseOpportunity = useMemo(() => {
    const expenses = rangeScopedTransactions.filter(isUserFacingExpense)
    return expenses
      .map((t) => {
        const btcPriceAtTime = getPriceOnDate(t.date)
        const btcValueToday =
          currentPrice && btcPriceAtTime > 0 ? (t.amount / btcPriceAtTime) * currentPrice : 0
        const opportunityCost = calculateOpportunityCost(t.amount, t.date)
        return { t, btcValueToday, opportunityCost, btcPriceAtTime }
      })
      .sort((a, b) => b.opportunityCost - a.opportunityCost)
  }, [rangeScopedTransactions, calculateOpportunityCost, getPriceOnDate, currentPrice])

  const rankedSavingsInflows = useMemo(() => {
    if (!savingsEnvelope) return []
    return rangeScopedTransactions
      .filter((t) => isSavingsInflowCredit(t, savingsEnvelope.id))
      .map((t) => {
        const btcPriceAtTime = getPriceOnDate(t.date)
        const btcValueToday =
          currentPrice && btcPriceAtTime > 0 ? (t.amount / btcPriceAtTime) * currentPrice : 0
        const opportunityCost = calculateOpportunityCost(t.amount, t.date)
        return { t, btcValueToday, opportunityCost, btcPriceAtTime }
      })
      .sort((a, b) => b.btcValueToday - a.btcValueToday)
  }, [rangeScopedTransactions, savingsEnvelope, calculateOpportunityCost, getPriceOnDate, currentPrice])

  const topTransactions = useMemo((): EnrichedTransaction[] => {
    const source = savingsMode ? rankedSavingsInflows : rankedExpenseOpportunity
    return source.slice(0, 10).map(({ t, btcValueToday, opportunityCost, btcPriceAtTime }) => ({
      ...t,
      btcValueToday,
      opportunityCost,
      btcPriceAtTime,
    }))
  }, [savingsMode, rankedSavingsInflows, rankedExpenseOpportunity])

  if (!state.opportunityCostEnabled) {
    return null
  }

  return (
    <div className="bg-[#0D0D0D] rounded-2xl p-4 md:p-6">
      <div className="flex flex-col gap-1 mb-5">
        <h2 className="text-lg font-semibold text-foreground">
          {savingsMode ? "Your biggest saves" : "Top Opportunity Costs"}
        </h2>
        <p className="text-xs text-muted-foreground">
          {savingsMode
            ? "Income and credits to Savings ranked by BTC-equivalent value today."
            : "What each expense would be worth today if you'd saved the money in BTC instead."}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-muted-foreground text-xs uppercase tracking-wider border-b border-[#1F1F1F]">
              <th className="hidden xs:table-cell pb-3 text-left font-medium pl-2 w-8">#</th>
              <th className="pb-3 text-left font-medium">Payee</th>
              <th className="pb-3 text-left font-medium hidden sm:table-cell">Date</th>
              <th className="pb-3 text-right font-medium">{savingsMode ? "Saved" : "Spent"}</th>
              <th className="pb-3 text-right font-medium hidden md:table-cell">BTC Price</th>
              <th className="pb-3 text-right font-medium hidden lg:table-cell">{state.btcDisplayUnit === "btc" ? "BTC" : "Sats"} Equiv.</th>
              <th className="pb-3 text-right font-medium pr-2">BTC Value Today</th>
              {!savingsMode && (
                <th className="hidden sm:table-cell pb-3 text-right font-medium pr-2 rounded-r-xl">Opp. Cost</th>
              )}
            </tr>
          </thead>
          <tbody>
            {topTransactions.map((txn, idx) => {
              const multiplier = txn.amount > 0 && txn.btcValueToday > 0 ? txn.btcValueToday / txn.amount : 0
              const gained = multiplier >= 1
              const pctChange = Math.abs((multiplier - 1) * 100)
              return (
                <tr
                  key={txn.id}
                  className="group hover:bg-[#1A1A1A] transition-colors cursor-pointer"
                  onClick={() => setSelectedTxn(txn)}
                >
                  <td className="hidden xs:table-cell py-3 pl-2 text-muted-foreground text-sm rounded-l-xl">{idx + 1}</td>
                  <td className="py-3 overflow-x-hidden">
                    <span className="font-medium text-foreground text-sm">
                      {txn.isDecrypted === false ? (
                        <span className="text-muted-foreground italic">{ENCRYPTED_DISPLAY}</span>
                      ) : (
                        txn.payee
                      )}
                    </span>
                  </td>
                  <td className="py-3 text-muted-foreground text-sm hidden sm:table-cell">
                    {formatTransactionTableDate(txn.date)}
                  </td>
                  <td className="py-3 text-right text-muted-foreground text-sm pr-1 sm:pr-0">
                    {formatUsd(txn.amount)}
                  </td>
                  <td className="py-3 text-right text-muted-foreground text-sm hidden md:table-cell">
                    {formatUsd(txn.btcPriceAtTime)}
                  </td>
                  <td className="py-3 text-right text-muted-foreground text-sm hidden lg:table-cell">
                    {txn.btcPriceAtTime > 0 ? (
                      <span className={state.btcDisplayUnit === "btc" ? "font-mono" : ""}>
                        <FormattedBtcAmount
                          btcValue={txn.amount / txn.btcPriceAtTime}
                          unit={state.btcDisplayUnit}
                          displayUnit={true}
                        />
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={`py-3 text-right ${savingsMode ? "pr-2 rounded-r-xl" : ""}`}>
                    <div className="flex items-center justify-end gap-2">
                      <span
                        className={`text-sm font-semibold ${gained ? "" : "text-[#22C55E]"}`}
                        style={gained ? { color: SAVINGS_GOLD_ACCENT } : undefined}
                      >
                        {formatUsd(txn.btcValueToday)}
                      </span>
                      {txn.btcValueToday > 0 && (
                        <PriceGainLossBadge gained={gained} percentChange={pctChange} />
                      )}
                    </div>
                  </td>
                  {!savingsMode && (
                    <td className="py-3 text-right text-muted-foreground text-sm hidden sm:table-cell pr-2 rounded-r-xl">
                      {formatUsd(txn.opportunityCost)}
                    </td>
                  )}
                </tr>
              )
            })}
            {topTransactions.length === 0 && (
              <tr>
                <td colSpan={savingsMode ? 7 : 8} className="py-8 text-center text-muted-foreground text-sm">
                  {rangeScopedTransactions.length === 0 && activeTransactions.length > 0
                    ? "No transactions in this timeframe."
                    : savingsMode
                      ? "No Savings inflows yet. Add income to see your biggest saves."
                      : "No expense transactions yet. Add one to see opportunity costs."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <TransactionDetailDialog
        transaction={selectedTxn}
        open={!!selectedTxn}
        onOpenChange={(open) => { if (!open) setSelectedTxn(null) }}
      />
    </div>
  )
}
