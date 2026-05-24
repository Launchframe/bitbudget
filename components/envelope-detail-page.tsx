"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { useApp } from "@/lib/app-context"
import { useBtcPrices } from "@/lib/btc-price-context"
import { compareTransactionsDesc, getEnvelopeBalance, getCurrentMonthKey, formatUsd, type Transaction } from "@/lib/data"
import { SYSTEM_ENVELOPE_ROLE_SAVINGS } from "@/lib/constants"
import {
  displayPayeeForTransaction,
  displayTypeLabelForTransaction,
  typeBadgeClassForTransaction,
  transactionMatchesTypeFilter,
  type TransactionListTypeFilter,
} from "@/lib/ledger-funding-display"
import { TransactionDetailDialog } from "@/components/transaction-detail-dialog"
import { FormattedBtcAmountFromSats } from "@/components/formatted-btc-sats-amount"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, Search, ChevronLeft, ChevronRight, Trash2, Repeat } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const PAGE_SIZE_OPTIONS = [10, 15, 25, 50, 100]
const MOBILE_PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

export function EnvelopeDetailPage() {
  const { state, selectedEnvelopeId, highlightTransactionId, navigateTo, deleteTransaction } = useApp()
  const { calculateOpportunityCost } = useBtcPrices()

  const envelope = state.envelopes.find((e) => e.id === selectedEnvelopeId)

  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState<TransactionListTypeFilter>("all")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(1)
  const highlightedRef = useRef<HTMLTableRowElement>(null)

  const currentMonth = getCurrentMonthKey()

  const envelopeTransactions = useMemo(
    () => state.transactions.filter((t) => t.envelopeId === selectedEnvelopeId),
    [state.transactions, selectedEnvelopeId],
  )

  const filteredTransactions = useMemo(() => {
    let result = envelopeTransactions

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter((t) => {
        const displayPayee = displayPayeeForTransaction(t, state.transactions)
        return displayPayee.toLowerCase().includes(q) || t.payee.toLowerCase().includes(q)
      })
    }

    if (typeFilter !== "all") {
      result = result.filter((t) => transactionMatchesTypeFilter(t, typeFilter))
    }

    if (startDate) {
      result = result.filter((t) => t.date >= startDate)
    }
    if (endDate) {
      result = result.filter((t) => t.date <= endDate)
    }

    return result.sort(compareTransactionsDesc)
  }, [envelopeTransactions, state.transactions, searchQuery, typeFilter, startDate, endDate])

  const totalPages = Math.max(1, Math.ceil(filteredTransactions.length / pageSize))
  const paginatedTransactions = filteredTransactions.slice((page - 1) * pageSize, page * pageSize)

  useEffect(() => {
    if (!highlightTransactionId) return
    const idx = filteredTransactions.findIndex(t => t.id === highlightTransactionId)
    if (idx === -1) return
    const targetPage = Math.floor(idx / pageSize) + 1
    if (targetPage !== page) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- jump to page containing deep-linked transaction
      setPage(targetPage)
    }
  }, [highlightTransactionId, filteredTransactions, pageSize]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (highlightTransactionId && highlightedRef.current) {
      highlightedRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [highlightTransactionId, page])

  if (!envelope) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-muted-foreground">Envelope not found.</p>
        <button
          onClick={() => navigateTo("envelopes")}
          className="text-[#F7931A] hover:underline text-sm"
        >
          Back to Envelopes
        </button>
      </div>
    )
  }

  const balance = getEnvelopeBalance(state.transactions, envelope.id, currentMonth, envelope.monthlyAllotment, {
    ledgerFundingEnabled: state.ledgerFundingEnabled,
  })
  const isLedgerSavingsHub =
    state.ledgerFundingEnabled && envelope.systemRole === SYSTEM_ENVELOPE_ROLE_SAVINGS
  const percentage =
    !isLedgerSavingsHub && envelope.monthlyAllotment > 0
      ? Math.max(0, (balance / envelope.monthlyAllotment) * 100)
      : 0
  const healthColor = isLedgerSavingsHub
    ? balance > 0
      ? "#22C55E"
      : balance < 0
        ? "#EF4444"
        : "#A3A3A3"
    : percentage > 25
      ? "#22C55E"
      : percentage > 10
        ? "#EAB308"
        : "#EF4444"

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 p-4 md:p-6 bg-[#0D0D0D] rounded-2xl">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigateTo("envelopes")}
            className="p-2 rounded-lg hover:bg-[#1A1A1A] text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Back to Envelopes"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: envelope.color }} />
            <h2 className="text-xl font-semibold text-foreground">{envelope.name} Transactions</h2>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 mt-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Monthly Allotment</span>
            <span className="text-lg font-semibold text-foreground">{formatUsd(envelope.monthlyAllotment)}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">
              {isLedgerSavingsHub ? "Balance" : "Remaining"}
            </span>
            <span className="text-lg font-semibold" style={{ color: healthColor }}>
              {formatUsd(balance)}
            </span>
          </div>
          {!isLedgerSavingsHub && (
            <div className="flex-1 max-w-xs">
              <Progress
                value={Math.min(100, percentage)}
                className="h-2.5"
                style={{
                  // @ts-expect-error - CSS custom properties
                  "--progress-color": healthColor,
                }}
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setPage(1)
            }}
            placeholder="Search payee..."
            className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground placeholder:text-[#555] pl-10"
          />
        </div>

        <Select
          value={typeFilter}
          onValueChange={(v) => {
            setTypeFilter(v as TransactionListTypeFilter)
            setPage(1)
          }}
        >
          <SelectTrigger className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#1A1A1A] border-[#333]">
            <SelectItem value="all" className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">All Types</SelectItem>
            <SelectItem value="expense" className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">Expenses</SelectItem>
            <SelectItem value="credit" className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">Credits</SelectItem>
            <SelectItem value="income" className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">Income</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value)
              setPage(1)
            }}
            className="bg-[#0D0D0D] border border-[#1F1F1F] rounded-lg px-3 py-1.5 text-sm text-foreground"
            placeholder="Start date"
          />
          <span className="text-muted-foreground text-sm">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value)
              setPage(1)
            }}
            className="bg-[#0D0D0D] border border-[#1F1F1F] rounded-lg px-3 py-1.5 text-sm text-foreground"
            placeholder="End date"
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
                <th className="py-3 px-4 text-left font-medium">Type</th>
                <th className="py-3 px-4 text-right font-medium">Amount (USD)</th>
                {state.opportunityCostEnabled && <th className="py-3 px-4 text-right font-medium hidden md:table-cell">Amount ({state.btcDisplayUnit === "sats" ? "sats" : "BTC"})</th>}
                {state.opportunityCostEnabled && <th className="py-3 px-4 text-right font-medium hidden sm:table-cell">Opportunity Cost</th>}
                <th className="py-3 px-4 text-right font-medium w-12"></th>
              </tr>
            </thead>
            <tbody>
              {paginatedTransactions.map((txn) => {
                const opCost = calculateOpportunityCost(txn.amount, txn.date)
                const isHighlighted = txn.id === highlightTransactionId
                const payeeLabel = displayPayeeForTransaction(txn, state.transactions)
                return (
                  <tr
                    key={txn.id}
                    ref={isHighlighted ? highlightedRef : undefined}
                    className={`border-b border-[#1A1A1A] last:border-0 hover:bg-[#111] transition-colors group cursor-pointer ${isHighlighted ? "bg-[#F7931A]/10 ring-1 ring-inset ring-[#F7931A]/30" : ""}`}
                    onClick={() => setSelectedTxn(txn)}
                  >
                    <td className="py-3.5 px-4 text-sm text-muted-foreground">
                      {new Date(txn.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td className="py-3.5 px-4 text-sm font-medium text-foreground">
                      <span className="flex items-center gap-1.5">
                        {payeeLabel}
                        {txn.recurringId && (
                          <span title="Recurring transaction"><Repeat className="h-3 w-3 text-muted-foreground shrink-0" /></span>
                        )}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <Badge
                        variant="outline"
                        className={typeBadgeClassForTransaction(txn)}
                      >
                        {displayTypeLabelForTransaction(txn)}
                      </Badge>
                    </td>
                    <td className="py-3.5 px-4 text-right text-sm font-medium text-foreground">
                      {formatUsd(txn.amount)}
                    </td>
                    {state.opportunityCostEnabled && (
                      <td className="py-3.5 px-4 text-right text-sm text-muted-foreground hidden md:table-cell">
                        {txn.satsAmount != null ? (
                          <FormattedBtcAmountFromSats
                            sats={txn.satsAmount}
                            unit={state.btcDisplayUnit}
                            className={state.btcDisplayUnit === "btc" ? "font-ibm-plex-mono" : ""}
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                    )}
                    {state.opportunityCostEnabled && (
                      <td className="py-3.5 px-4 text-right text-sm font-semibold text-[#F7931A] hidden sm:table-cell">
                        {txn.type === "expense" ? formatUsd(opCost) : "--"}
                      </td>
                    )}
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

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-4 py-3 border-t border-[#1F1F1F]">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {filteredTransactions.length > 0
                ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filteredTransactions.length)} of ${filteredTransactions.length}`
                : "0 results"}
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
                disabled={page === 1}
                className="p-1.5 rounded-md hover:bg-[#1A1A1A] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs text-muted-foreground px-2 sm:hidden">{page} / {totalPages}</span>
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
                    className={`hidden sm:inline-flex items-center justify-center w-8 h-8 rounded-md text-xs font-medium transition-colors ${
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
          )}
        </div>
      </div>

      <TransactionDetailDialog
        transaction={selectedTxn}
        open={!!selectedTxn}
        onOpenChange={(open) => { if (!open) setSelectedTxn(null) }}
        onNavigateToLinkedIncome={(incomeTxn) => {
          navigateTo("transactions", undefined, { envelopeFilter: incomeTxn.envelopeId })
          setSelectedTxn(incomeTxn)
        }}
      />
    </div>
  )
}
