"use client"

import { useState, useMemo } from "react"
import { useApp } from "@/lib/app-context"
import { compareTransactionsDesc, formatUsd, transactionsVisibleInMainHistory } from "@/lib/data"
import type { Transaction } from "@/lib/data"
import { Badge } from "@/components/ui/badge"
import { ChevronLeft, ChevronRight, Repeat, Trash2 } from "lucide-react"
import { ENCRYPTED_DISPLAY } from "@/lib/encrypted-display"
import { Skeleton } from "@/components/ui/skeleton"
import { TransactionDetailDialog } from "@/components/transaction-detail-dialog"
import { formatTransactionTableDate } from "@/lib/transaction-dates"

const PAGE_SIZE_OPTIONS = [10, 15, 25, 50, 100]
const MOBILE_PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

export function RecentTransactions() {
  const { state, activeTransactions, deleteTransaction, loading } = useApp()
  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null)
  const [pageSize, setPageSize] = useState(15)
  const [page, setPage] = useState(1)

  const envelopeMap = useMemo(() => {
    const map: Record<string, { name: string; color: string }> = {}
    for (const e of state.envelopes) map[e.id] = { name: e.name, color: e.color }
    return map
  }, [state.envelopes])

  const visible = useMemo(
    () => transactionsVisibleInMainHistory(activeTransactions),
    [activeTransactions],
  )

  const sorted = useMemo(
    () => [...visible].sort(compareTransactionsDesc),
    [visible],
  )

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paginated = sorted.slice((safePage - 1) * pageSize, safePage * pageSize)

  if (loading) {
    return (
      <div className="bg-[#0D0D0D] rounded-2xl overflow-hidden">
        <div className="px-4 md:px-6 pt-4 md:pt-6 pb-3">
          <Skeleton className="h-6 w-48 rounded-md bg-[#1A1A1A]" />
        </div>
        <div className="px-4 pb-4 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg bg-[#1A1A1A]" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-[#0D0D0D] rounded-2xl overflow-hidden">
      <div className="px-4 md:px-6 pt-4 md:pt-6 pb-3">
        <h2 className="text-lg font-semibold text-foreground">Recent Transactions</h2>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-muted-foreground text-xs uppercase tracking-wider border-b border-[#1F1F1F]">
              <th className="py-3 px-4 text-left font-medium">Date</th>
              <th className="py-3 px-4 text-left font-medium">Payee</th>
              <th className="py-3 px-4 text-left font-medium hidden md:table-cell">Envelope</th>
              <th className="py-3 px-4 text-left font-medium hidden sm:table-cell">Type</th>
              <th className="py-3 px-4 text-right font-medium">Amount</th>
              <th className="py-3 px-4 text-right font-medium w-12"></th>
            </tr>
          </thead>
          <tbody>
            {paginated.map((txn) => {
              const env = envelopeMap[txn.envelopeId]
              return (
                <tr
                  key={txn.id}
                  className="border-b border-[#1A1A1A] last:border-0 hover:bg-[#111] transition-colors group cursor-pointer"
                  onClick={() => setSelectedTxn(txn)}
                >
                  <td className="py-3.5 px-4 text-sm text-muted-foreground whitespace-nowrap">
                    {formatTransactionTableDate(txn.date)}
                  </td>
                  <td className="py-3.5 px-4 text-sm font-medium text-foreground">
                    <span className="flex items-center gap-1.5">
                      {txn.isDecrypted === false ? (
                        <span className="text-muted-foreground italic">{ENCRYPTED_DISPLAY}</span>
                      ) : (
                        txn.payee
                      )}
                      {txn.recurringId && (
                        <span title="Recurring transaction">
                          <Repeat className="h-3 w-3 text-muted-foreground shrink-0" />
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 hidden md:table-cell">
                    {env ? (
                      <span className="flex items-center gap-2 text-sm text-muted-foreground">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: env.color }} />
                        {env.name}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 hidden sm:table-cell">
                    <Badge
                      variant="outline"
                      className={
                        txn.type === "expense"
                          ? "border-[#F7931A]/30 text-[#F7931A] bg-[#F7931A]/5"
                          : "border-[#22C55E]/30 text-[#22C55E] bg-[#22C55E]/5"
                      }
                    >
                      {txn.type === "expense" ? "Expense" : "Credit"}
                    </Badge>
                  </td>
                  <td className="py-3.5 px-4 text-right text-sm font-medium text-foreground">
                    {formatUsd(txn.amount)}
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteTransaction(txn.id) }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#1F1F1F] text-muted-foreground hover:text-[#EF4444] transition-all"
                      aria-label={`Delete transaction ${txn.payee}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              )
            })}
            {paginated.length === 0 && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-muted-foreground text-sm">
                  No transactions yet. Add one to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-4 py-3 border-t border-[#1F1F1F]">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {sorted.length > 0
              ? `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, sorted.length)} of ${sorted.length}`
              : "0 transactions"}
          </span>
          <div className="flex items-center gap-1.5 sm:hidden">
            {MOBILE_PAGE_SIZE_OPTIONS.map((n) => (
              <button
                key={n}
                onClick={() => { setPageSize(n); setPage(1) }}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  pageSize === n
                    ? "bg-[#F7931A] text-[#0D0D0D]"
                    : "bg-[#1A1A1A] text-muted-foreground hover:text-foreground"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="hidden sm:flex items-center gap-1.5">
            <span className="text-sm text-muted-foreground">Per page</span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}
              className="bg-[#1A1A1A] border border-[#333] rounded-md px-2 py-1.5 text-sm text-foreground"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="p-1.5 rounded-md hover:bg-[#1A1A1A] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs text-muted-foreground px-2 sm:hidden">{safePage} / {totalPages}</span>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let p: number
              if (totalPages <= 7) {
                p = i + 1
              } else if (safePage <= 4) {
                p = i + 1
              } else if (safePage >= totalPages - 3) {
                p = totalPages - 6 + i
              } else {
                p = safePage - 3 + i
              }
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`hidden sm:inline-flex items-center justify-center w-8 h-8 rounded-md text-xs font-medium transition-colors ${
                    p === safePage
                      ? "bg-[#F7931A] text-[#0D0D0D]"
                      : "text-muted-foreground hover:bg-[#1A1A1A] hover:text-foreground"
                  }`}
                >
                  {p}
                </button>
              )
            })}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="p-1.5 rounded-md hover:bg-[#1A1A1A] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <TransactionDetailDialog
        transaction={selectedTxn}
        open={!!selectedTxn}
        onOpenChange={(open) => { if (!open) setSelectedTxn(null) }}
      />
    </div>
  )
}
