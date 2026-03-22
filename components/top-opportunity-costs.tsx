"use client"

import { useMemo, useState, useEffect } from "react"
import { useApp } from "@/lib/app-context"
import { useBtcPrices } from "@/lib/btc-price-context"
import { formatUsd, formatBtcAmount } from "@/lib/data"
import { TrendingUp, TrendingDown } from "lucide-react"
import { TransactionDetailDialog } from "@/components/transaction-detail-dialog"
import { ENCRYPTED_DISPLAY } from "@/lib/encrypted-display"
import {
  cachedToClientTransaction,
  getCachedByIds,
  getMemo,
  MEMO_KEYS,
  setMemo,
} from "@/lib/txn-cache"

import type { Transaction } from "@/lib/data"

interface EnrichedTransaction extends Transaction {
  btcValueToday: number
  btcPriceAtTime: number
}

export function TopOpportunityCosts() {
  const { activeTransactions, state, currentUserId, txnLoadPhase } = useApp()
  const { calculateOpportunityCost, getPriceOnDate } = useBtcPrices()
  const [selectedTxn, setSelectedTxn] = useState<EnrichedTransaction | null>(null)
  const [memoBootstrapTxns, setMemoBootstrapTxns] = useState<Transaction[]>([])

  useEffect(() => {
    if (!currentUserId || !state.opportunityCostEnabled) {
      setMemoBootstrapTxns([])
      return
    }
    let cancelled = false
    void (async () => {
      const ids = await getMemo<string[]>(currentUserId, MEMO_KEYS.topOCIds)
      if (!ids?.length || cancelled) return
      const cached = await getCachedByIds(currentUserId, ids.slice(0, 100))
      if (cancelled) return
      setMemoBootstrapTxns(cached.map(cachedToClientTransaction))
    })()
    return () => {
      cancelled = true
    }
  }, [currentUserId, state.opportunityCostEnabled])

  useEffect(() => {
    if (!currentUserId || !state.opportunityCostEnabled || txnLoadPhase !== "synced") return
    const expenses = activeTransactions.filter((t) => t.type === "expense")
    const ranked = expenses
      .map((t) => ({ id: t.id, oc: calculateOpportunityCost(t.amount, t.date) }))
      .sort((a, b) => b.oc - a.oc)
      .slice(0, 100)
      .map((x) => x.id)
    void setMemo(currentUserId, MEMO_KEYS.topOCIds, ranked)
  }, [
    currentUserId,
    state.opportunityCostEnabled,
    txnLoadPhase,
    activeTransactions,
    calculateOpportunityCost,
  ])

  const topTransactions = useMemo(() => {
    const enrich = (t: Transaction): EnrichedTransaction => ({
      ...t,
      btcValueToday: calculateOpportunityCost(t.amount, t.date),
      btcPriceAtTime: getPriceOnDate(t.date),
    })

    const fromLive = activeTransactions
      .filter((t) => t.type === "expense")
      .map(enrich)
      .sort((a, b) => b.btcValueToday - a.btcValueToday)
      .slice(0, 10)

    if (txnLoadPhase === "synced" || memoBootstrapTxns.length === 0) {
      return fromLive
    }

    const fromMemo = memoBootstrapTxns
      .filter((t) => t.type === "expense")
      .map(enrich)
      .slice(0, 10)

    return fromMemo.length > 0 ? fromMemo : fromLive
  }, [
    activeTransactions,
    calculateOpportunityCost,
    getPriceOnDate,
    memoBootstrapTxns,
    txnLoadPhase,
  ])

  return (
    <div className="bg-[#0D0D0D] rounded-2xl p-4 md:p-6">
      <div className="flex flex-col gap-1 mb-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Top Opportunity Costs</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          What each expense would be worth today if you&apos;d saved in BTC instead.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-muted-foreground text-xs uppercase tracking-wider border-b border-[#1F1F1F]">
              <th className="pb-3 text-left font-medium pl-2 w-8">#</th>
              <th className="pb-3 text-left font-medium">Payee</th>
              <th className="pb-3 text-left font-medium hidden sm:table-cell">Date</th>
              <th className="pb-3 text-right font-medium hidden md:table-cell">BTC Price</th>
              <th className="pb-3 text-right font-medium">Spent</th>
              <th className="pb-3 text-right font-medium hidden lg:table-cell">BTC Equiv.</th>
              <th className="pb-3 text-right font-medium pr-2">BTC Value Today</th>
            </tr>
          </thead>
          <tbody>
            {topTransactions.map((txn, idx) => {
              const multiplier = txn.btcValueToday / txn.amount
              const gained = multiplier >= 1
              const pctChange = Math.abs((multiplier - 1) * 100)
              return (
                <tr
                  key={txn.id}
                  className="group hover:bg-[#1A1A1A] transition-colors cursor-pointer"
                  onClick={() => setSelectedTxn(txn)}
                >
                  <td className="py-3 pl-2 text-muted-foreground text-sm rounded-l-xl">{idx + 1}</td>
                  <td className="py-3">
                    <span className="font-medium text-foreground text-sm">
                      {txn.isDecrypted === false ? (
                        <span className="text-muted-foreground italic">{ENCRYPTED_DISPLAY}</span>
                      ) : (
                        txn.payee
                      )}
                    </span>
                  </td>
                  <td className="py-3 text-muted-foreground text-sm hidden sm:table-cell">
                    {new Date(txn.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                  <td className="py-3 text-right text-muted-foreground text-sm hidden md:table-cell">
                    {formatUsd(txn.btcPriceAtTime)}
                  </td>
                  <td className="py-3 text-right text-muted-foreground text-sm">
                    {formatUsd(txn.amount)}
                  </td>
                  <td className="py-3 text-right text-muted-foreground text-sm hidden lg:table-cell">
                    {txn.btcPriceAtTime > 0
                      ? <span className={state.btcDisplayUnit === "btc" ? "font-ibm-plex-mono" : ""}>
                          {formatBtcAmount(txn.amount / txn.btcPriceAtTime, state.btcDisplayUnit)}
                        </span>
                      : "—"}
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
                <td colSpan={7} className="py-8 text-center text-muted-foreground text-sm">
                  No expense transactions yet. Add one to see opportunity costs.
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
