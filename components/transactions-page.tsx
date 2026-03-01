"use client"

import { useState, useMemo } from "react"
import { useApp } from "@/lib/app-context"
import { useBtcPrices } from "@/lib/btc-price-context"
import { formatUsd, type TransactionType } from "@/lib/data"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Search, ChevronLeft, ChevronRight, Trash2 } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const PAGE_SIZE = 15

export function TransactionsPage() {
  const { state, navigateTo, deleteTransaction } = useApp()
  const { calculateOpportunityCost } = useBtcPrices()

  const [searchQuery, setSearchQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState<"all" | TransactionType>("all")
  const [envelopeFilter, setEnvelopeFilter] = useState("all")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [page, setPage] = useState(1)

  const envelopeMap = useMemo(() => {
    const map: Record<string, { name: string; color: string }> = {}
    for (const e of state.envelopes) map[e.id] = { name: e.name, color: e.color }
    return map
  }, [state.envelopes])

  const filteredTransactions = useMemo(() => {
    let result = state.transactions

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter((t) => t.payee.toLowerCase().includes(q))
    }

    if (typeFilter !== "all") {
      result = result.filter((t) => t.type === typeFilter)
    }

    if (envelopeFilter !== "all") {
      result = result.filter((t) => t.envelopeId === envelopeFilter)
    }

    if (startDate) {
      result = result.filter((t) => t.date >= startDate)
    }
    if (endDate) {
      result = result.filter((t) => t.date <= endDate)
    }

    return result.sort((a, b) => b.date.localeCompare(a.date))
  }, [state.transactions, searchQuery, typeFilter, envelopeFilter, startDate, endDate])

  const totalPages = Math.max(1, Math.ceil(filteredTransactions.length / PAGE_SIZE))
  const paginatedTransactions = filteredTransactions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const totalAmount = filteredTransactions.reduce(
    (sum, t) => sum + (t.type === "expense" ? t.amount : -t.amount),
    0,
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 p-6 bg-[#0D0D0D] rounded-2xl">
        <h2 className="text-xl font-semibold text-foreground">All Transactions</h2>
        <div className="flex items-center gap-6 mt-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Total</span>
            <span className="text-lg font-semibold text-foreground">{filteredTransactions.length}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Net Expenses</span>
            <span className="text-lg font-semibold text-foreground">{formatUsd(totalAmount)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1) }}
            placeholder="Search payee..."
            className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground placeholder:text-[#555] pl-10"
          />
        </div>

        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v as "all" | TransactionType); setPage(1) }}>
          <SelectTrigger className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#1A1A1A] border-[#333]">
            <SelectItem value="all" className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">All Types</SelectItem>
            <SelectItem value="expense" className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">Expenses</SelectItem>
            <SelectItem value="credit" className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">Credits</SelectItem>
          </SelectContent>
        </Select>

        <Select value={envelopeFilter} onValueChange={(v) => { setEnvelopeFilter(v); setPage(1) }}>
          <SelectTrigger className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#1A1A1A] border-[#333]">
            <SelectItem value="all" className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">All Envelopes</SelectItem>
            {state.envelopes.map((e) => (
              <SelectItem key={e.id} value={e.id} className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">
                {e.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(1) }}
            className="bg-[#0D0D0D] border border-[#1F1F1F] rounded-lg px-3 py-1.5 text-sm text-foreground"
          />
          <span className="text-muted-foreground text-sm">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(1) }}
            className="bg-[#0D0D0D] border border-[#1F1F1F] rounded-lg px-3 py-1.5 text-sm text-foreground"
          />
        </div>
      </div>

      <div className="bg-[#0D0D0D] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-muted-foreground text-xs uppercase tracking-wider border-b border-[#1F1F1F]">
                <th className="py-3 px-4 text-left font-medium">Date</th>
                <th className="py-3 px-4 text-left font-medium">Payee</th>
                <th className="py-3 px-4 text-left font-medium hidden md:table-cell">Envelope</th>
                <th className="py-3 px-4 text-left font-medium">Type</th>
                <th className="py-3 px-4 text-right font-medium">Amount</th>
                <th className="py-3 px-4 text-right font-medium hidden sm:table-cell">Opportunity Cost</th>
                <th className="py-3 px-4 text-right font-medium w-12"></th>
              </tr>
            </thead>
            <tbody>
              {paginatedTransactions.map((txn) => {
                const opCost = calculateOpportunityCost(txn.amount, txn.date)
                const env = envelopeMap[txn.envelopeId]
                return (
                  <tr key={txn.id} className="border-b border-[#1A1A1A] last:border-0 hover:bg-[#111] transition-colors group">
                    <td className="py-3.5 px-4 text-sm text-muted-foreground whitespace-nowrap">
                      {new Date(txn.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td className="py-3.5 px-4 text-sm font-medium text-foreground">{txn.payee}</td>
                    <td className="py-3.5 px-4 hidden md:table-cell">
                      {env ? (
                        <button
                          onClick={() => navigateTo("envelope-detail", txn.envelopeId)}
                          className="flex items-center gap-2 hover:underline text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: env.color }} />
                          {env.name}
                        </button>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
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
                    <td className="py-3.5 px-4 text-right text-sm font-semibold text-[#F7931A] hidden sm:table-cell">
                      {txn.type === "expense" ? formatUsd(opCost) : "—"}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => deleteTransaction(txn.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#1F1F1F] text-muted-foreground hover:text-[#EF4444] transition-all"
                        aria-label={`Delete transaction ${txn.payee}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                )
              })}
              {paginatedTransactions.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-muted-foreground text-sm">
                    No transactions found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#1F1F1F]">
            <span className="text-xs text-muted-foreground">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredTransactions.length)} of {filteredTransactions.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-md hover:bg-[#1A1A1A] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let p: number
                if (totalPages <= 7) {
                  p = i + 1
                } else if (page <= 4) {
                  p = i + 1
                } else if (page >= totalPages - 3) {
                  p = totalPages - 6 + i
                } else {
                  p = page - 3 + i
                }
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`w-8 h-8 rounded-md text-xs font-medium transition-colors ${
                      p === page
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
                disabled={page === totalPages}
                className="p-1.5 rounded-md hover:bg-[#1A1A1A] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
