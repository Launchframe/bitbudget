"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import { useApp } from "@/lib/app-context"
import { useBtcPrices } from "@/lib/btc-price-context"
import { compareTransactionsDesc, formatUsd, formatUsdPrecise, transactionsForTransactionList, type BtcDisplayUnit } from "@/lib/data"
import {
  displayPayeeForTransaction,
  incomeTransactionsByFundingBatchId,
  displayTypeLabelForTransaction,
  typeBadgeClassForTransaction,
  REBALANCE_TYPE_BADGE_CLASS,
  transactionMatchesTypeFilter,
  type TransactionListTypeFilter,
} from "@/lib/ledger-funding-display"
import { FormattedBtcAmountFromSats } from "@/components/formatted-btc-sats-amount"
import { PriceGainLossBadge } from "@/components/price-gain-loss-badge"
import { buildExportFilename, buildTransactionsCsv } from "@/lib/transaction-export"
import { formatTransactionTableDate, transactionCalendarDay } from "@/lib/transaction-dates"
import type { Transaction } from "@/lib/data"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { EnvelopeIconDisplay } from "@/components/envelope-icon-display"
import { Search, ChevronLeft, ChevronRight, Trash2, Repeat, SlidersHorizontal, X, Plus, Download, PiggyBank } from "lucide-react"
import { ENCRYPTED_DISPLAY } from "@/lib/encrypted-display"
import { SAVINGS_GOLD_ACCENT } from "@/lib/constants"
import { findSavingsEnvelope } from "@/lib/savings-ui-metrics"
import { TransactionDetailDialog } from "@/components/transaction-detail-dialog"
import { useTransactionDeleteConfirm } from "@/components/use-transaction-delete-confirm"
import { canDeleteTransactionFromList } from "@/lib/transaction-batch-delete"
import {
  collapseRebalanceBatches,
  isRebalanceGroupRow,
} from "@/lib/rebalance-transaction-display"
import { RebalanceEnvelopesDialog } from "@/components/rebalance-envelopes-dialog"
import { TX_SOURCE_IRREGULAR_INCOME } from "@/lib/constants"
import { PayeeRulesReviewBanner } from "@/components/payee-rules-review-banner"
import { UpcomingRecurringTransactions } from "@/components/upcoming-recurring-transactions"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TransactionsCashFlowPanel } from "@/components/transactions-cash-flow-panel"

function BtcAmount({
  sats,
  unit,
  className,
}: {
  sats: number
  unit: BtcDisplayUnit
  className?: string
}) {
  return <FormattedBtcAmountFromSats sats={sats} unit={unit} className={className} />
}

const PAGE_SIZE_OPTIONS = [10, 15, 25, 50, 100]
const MOBILE_PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

export function TransactionsPage({ scopedEnvelopeId }: { scopedEnvelopeId?: string } = {}) {
  const {
    state,
    discretionaryEnvelopes,
    activeTransactions,
    highlightTransactionId,
    transactionEnvelopeFilter,
    clearTransactionEnvelopeFilter,
    openNewTransaction,
    historyReady,
    navigateTo,
  } = useApp()
  const { requestDelete, confirmDialog } = useTransactionDeleteConfirm()
  const { calculateOpportunityCost } = useBtcPrices()

  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState<TransactionListTypeFilter>("all")
  const [envelopeFilters, setEnvelopeFilters] = useState<Set<string>>(() => transactionEnvelopeFilter)
  const [tagFilters, setTagFilters] = useState<Set<string>>(() => new Set())
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [pageSize, setPageSize] = useState(15)
  const [page, setPage] = useState(1)
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false)
  const [rebalanceEditBatchId, setRebalanceEditBatchId] = useState<string | null>(null)
  const [rebalanceDialogOpen, setRebalanceDialogOpen] = useState(false)
  const moreFiltersRef = useRef<HTMLDivElement>(null)
  const highlightedRef = useRef<HTMLTableRowElement>(null)

  const activeEnvelopeFilters = useMemo(() => {
    if (scopedEnvelopeId) return new Set([scopedEnvelopeId])
    if (transactionEnvelopeFilter.size > 0) return transactionEnvelopeFilter
    return envelopeFilters
  }, [scopedEnvelopeId, transactionEnvelopeFilter, envelopeFilters])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (moreFiltersRef.current && !moreFiltersRef.current.contains(e.target as Node)) {
        setMoreFiltersOpen(false)
      }
    }
    if (moreFiltersOpen) document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [moreFiltersOpen])

  const savingsEnvelope = useMemo(() => findSavingsEnvelope(state.envelopes), [state.envelopes])

  const savingsOnlyFilter =
    savingsEnvelope != null &&
    activeEnvelopeFilters.size === 1 &&
    activeEnvelopeFilters.has(savingsEnvelope.id)

  const envelopeMap = useMemo(() => {
    const map: Record<string, { name: string; color: string; icon?: string | null }> = {}
    for (const e of state.envelopes) map[e.id] = { name: e.name, color: e.color, icon: e.icon }
    return map
  }, [state.envelopes])

  const listTransactions = useMemo(
    () =>
      transactionsForTransactionList(
        activeTransactions,
        activeEnvelopeFilters.size > 0 ? activeEnvelopeFilters : undefined,
      ),
    [activeTransactions, activeEnvelopeFilters],
  )

  const incomeByFundingBatchId = useMemo(
    () => incomeTransactionsByFundingBatchId(activeTransactions),
    [activeTransactions],
  )

  const availableTags = useMemo(() => {
    const tags = new Set<string>()
    for (const txn of listTransactions) {
      for (const tag of txn.tags ?? []) tags.add(tag)
    }
    return Array.from(tags).sort((a, b) => a.localeCompare(b))
  }, [listTransactions])

  const filteredTransactions = useMemo(() => {
    let result = listTransactions

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter((t) => {
        const displayPayee = displayPayeeForTransaction(t, activeTransactions, incomeByFundingBatchId)
        return (
          displayPayee.toLowerCase().includes(q) ||
          t.payee.toLowerCase().includes(q)
        )
      })
    }

    if (typeFilter !== "all") {
      result = result.filter((t) => transactionMatchesTypeFilter(t, typeFilter))
    }

    if (activeEnvelopeFilters.size > 0) {
      result = result.filter((t) => activeEnvelopeFilters.has(t.envelopeId))
    }

    if (tagFilters.size > 0) {
      result = result.filter((t) => t.tags?.some((tag) => tagFilters.has(tag)))
    }

    if (startDate) {
      result = result.filter((t) => transactionCalendarDay(t.date) >= startDate)
    }
    if (endDate) {
      result = result.filter((t) => transactionCalendarDay(t.date) <= endDate)
    }

    return [...result].sort(compareTransactionsDesc)
  }, [listTransactions, activeTransactions, incomeByFundingBatchId, searchQuery, typeFilter, activeEnvelopeFilters, tagFilters, startDate, endDate])

  const displayRows = useMemo(
    () => collapseRebalanceBatches(filteredTransactions, savingsEnvelope?.id),
    [filteredTransactions, savingsEnvelope?.id],
  )

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

  const totalPages = Math.max(1, Math.ceil(displayRows.length / pageSize))
  const paginatedRows = displayRows.slice((page - 1) * pageSize, page * pageSize)

  const expenseTxns = useMemo(
    () => filteredTransactions.filter(t => t.type === "expense"),
    [filteredTransactions],
  )
  const totalExpenses = expenseTxns.reduce((sum, t) => sum + t.amount, 0)
  const totalCredits = filteredTransactions
    .filter(t => t.type === "credit")
    .reduce((sum, t) => sum + t.amount, 0)

  const totalOpportunityCost = useMemo(() => {
    return expenseTxns.reduce((sum, t) => sum + calculateOpportunityCost(t.amount, t.date), 0)
  }, [expenseTxns, calculateOpportunityCost])

  const totalSats = useMemo(() => {
    return expenseTxns.reduce((sum, t) => sum + (t.satsAmount ?? 0), 0)
  }, [expenseTxns])

  const hasActiveFilter =
    searchQuery.trim() ||
    typeFilter !== "all" ||
    (!scopedEnvelopeId && activeEnvelopeFilters.size > 0) ||
    tagFilters.size > 0 ||
    startDate ||
    endDate

  const transactionsHeroTitle = useMemo(() => {
    const anyFilter =
      searchQuery.trim() ||
      typeFilter !== "all" ||
      (!scopedEnvelopeId && activeEnvelopeFilters.size > 0) ||
      tagFilters.size > 0 ||
      startDate ||
      endDate
    if (!anyFilter) return "All Transactions"
    if (!scopedEnvelopeId && activeEnvelopeFilters.size === 1) {
      const id = [...activeEnvelopeFilters][0]!
      const name = envelopeMap[id]?.name ?? "This envelope"
      const hasExtra =
        typeFilter !== "all" ||
        searchQuery.trim() ||
        tagFilters.size > 0 ||
        !!startDate ||
        !!endDate
      return hasExtra ? `${name} — filtered` : `${name} transactions`
    }
    return "Filtered transactions"
  }, [
    scopedEnvelopeId,
    activeEnvelopeFilters,
    envelopeMap,
    typeFilter,
    searchQuery,
    tagFilters,
    startDate,
    endDate,
  ])

  function toggleEnvelopeFilter(id: string) {
    if (scopedEnvelopeId) return
    clearTransactionEnvelopeFilter()
    setEnvelopeFilters(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setPage(1)
  }

  function toggleTagFilter(tag: string) {
    setTagFilters(prev => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
    setPage(1)
  }

  function handleExport() {
    const now = new Date()
    const stampDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
    const envelopeNames =
      activeEnvelopeFilters.size > 0
        ? Array.from(activeEnvelopeFilters).map((id) => envelopeMap[id]?.name ?? id)
        : undefined
    const tagNames = tagFilters.size > 0 ? Array.from(tagFilters) : undefined
    const filename = buildExportFilename({
      stampDate,
      hasPayeeSearch: !!searchQuery.trim(),
      typeFilter: typeFilter === "all" ? undefined : typeFilter,
      envelopeNames,
      tagNames,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    })
    const rows = filteredTransactions.map((t) => {
      const amount = t.type === "expense" ? -Math.abs(t.amount) : Math.abs(t.amount)
      return {
        type: t.type,
        date: t.date,
        payee: t.payee,
        amountFormatted: formatUsdPrecise(amount),
        notes: t.notes ?? "",
        envelopeName: envelopeMap[t.envelopeId]?.name ?? "",
        tags: (t.tags ?? []).join(", "),
      }
    })
    const csv = buildTransactionsCsv(rows)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    // Defer revoking the object URL to ensure the download has started in all browsers.
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  return (
    <div className="flex flex-col gap-6">
      {!scopedEnvelopeId && (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-6">
          <div className="flex flex-col gap-1 rounded-2xl bg-[#0D0D0D] p-4 md:p-6 lg:w-[min(100%,24rem)] lg:max-w-md lg:shrink-0">
            <h2 className="text-xl font-semibold text-foreground" data-walkthrough="transactions-header">
              {transactionsHeroTitle}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-4 md:gap-6">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Total</span>
                <span className="text-lg font-semibold text-foreground">{filteredTransactions.length}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Expenses</span>
                <span className="text-lg font-semibold text-foreground">{formatUsd(totalExpenses)}</span>
              </div>
              {totalCredits > 0 && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Credits</span>
                  <span className="text-lg font-semibold text-[#22C55E]">{formatUsd(totalCredits)}</span>
                </div>
              )}
              {state.opportunityCostEnabled && hasActiveFilter && expenseTxns.length > 0 && (
                <>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">You could have stacked</span>
                    <BtcAmount
                      sats={totalSats}
                      unit={state.btcDisplayUnit}
                      className="text-lg font-semibold text-foreground"
                    />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">Opportunity Cost</span>
                    <span className="text-lg font-semibold text-[#F7931A]">{formatUsd(totalOpportunityCost)}</span>
                  </div>
                </>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2 self-start">
              <button
                type="button"
                onClick={() => openNewTransaction()}
                className="flex items-center gap-2 rounded-xl bg-[#F7931A] px-4 py-2.5 text-sm font-semibold text-[#0D0D0D] transition-colors hover:bg-[#F7931A]/90 md:hidden"
              >
                <Plus className="h-4 w-4" />
                New Transaction
              </button>
              <button
                type="button"
                onClick={handleExport}
                className="flex items-center gap-2 rounded-xl border border-[#333] bg-[#0D0D0D] px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-[#1A1A1A]"
              >
                <Download className="h-4 w-4" />
                Export
              </button>
            </div>
          </div>
          <TransactionsCashFlowPanel />
        </div>
      )}

      {scopedEnvelopeId && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => openNewTransaction()}
            className="flex items-center gap-2 rounded-xl bg-[#F7931A] px-4 py-2.5 text-sm font-semibold text-[#0D0D0D] transition-colors hover:bg-[#F7931A]/90"
          >
            <Plus className="h-4 w-4" />
            New Transaction
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-2 rounded-xl border border-[#333] bg-[#0D0D0D] px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-[#1A1A1A]"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
        </div>
      )}

      <PayeeRulesReviewBanner />

      <div className="flex flex-col gap-3">
        {/* Search + mobile overflow trigger */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1) }}
              placeholder="Search existing transactions..."
              className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground placeholder:text-[#555] pl-10"
            />
          </div>

          {/* Mobile: "More filters" toggle */}
          <div className="relative sm:hidden" ref={moreFiltersRef}>
            <button
              type="button"
              onClick={() => setMoreFiltersOpen(o => !o)}
              className={`flex items-center justify-center w-10 h-10 rounded-lg border transition-colors ${
                moreFiltersOpen || typeFilter !== "all" || tagFilters.size > 0 || startDate || endDate
                  ? "bg-[#F7931A]/10 border-[#F7931A]/40 text-[#F7931A]"
                  : "bg-[#0D0D0D] border-[#1F1F1F] text-muted-foreground"
              }`}
              aria-label="More filters"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>

            {moreFiltersOpen && (
              <div className="absolute right-0 top-full mt-2 z-30 bg-[#1A1A1A] border border-[#333] rounded-xl p-4 flex flex-col gap-4 min-w-[260px] shadow-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Filters</span>
                  <button type="button" onClick={() => setMoreFiltersOpen(false)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted-foreground">Type</span>
                  <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v as TransactionListTypeFilter); setPage(1) }}>
                    <SelectTrigger className="bg-[#0D0D0D] border-[#333] text-foreground w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#1A1A1A] border-[#333]">
                      <SelectItem value="all" className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">All Types</SelectItem>
                      <SelectItem value="expense" className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">Expenses</SelectItem>
                      <SelectItem value="credit" className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">Credits</SelectItem>
                      <SelectItem value="income" className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">Income</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted-foreground">Date range</span>
                  <div className="flex flex-col gap-2">
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => { setStartDate(e.target.value); setPage(1) }}
                      className="bg-[#0D0D0D] border border-[#333] rounded-lg px-3 py-1.5 text-sm text-foreground w-full"
                    />
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => { setEndDate(e.target.value); setPage(1) }}
                      className="bg-[#0D0D0D] border border-[#333] rounded-lg px-3 py-1.5 text-sm text-foreground w-full"
                    />
                  </div>
                </div>

                {(typeFilter !== "all" || tagFilters.size > 0 || startDate || endDate) && (
                  <button
                    type="button"
                    onClick={() => { setTypeFilter("all"); setTagFilters(new Set()); setStartDate(""); setEndDate(""); setMoreFiltersOpen(false); setPage(1) }}
                    className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 self-start transition-colors"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Desktop: Type select */}
          <div className="hidden sm:block">
            <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v as TransactionListTypeFilter); setPage(1) }}>
              <SelectTrigger
                data-testid="transactions-type-filter"
                className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground w-[140px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#1A1A1A] border-[#333]">
                <SelectItem value="all" className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">All Types</SelectItem>
                <SelectItem value="expense" className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">Expenses</SelectItem>
                <SelectItem value="credit" className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">Credits</SelectItem>
                <SelectItem value="income" className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">Income</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Desktop: date range */}
          <div className="hidden sm:flex items-center gap-2">
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

        {/* Envelope quick-filter bubbles */}
        {(savingsEnvelope || discretionaryEnvelopes.length > 0) && !scopedEnvelopeId && (
          <div className="flex items-center gap-2 flex-wrap">
            {savingsEnvelope && (
              <>
                <button
                  type="button"
                  onClick={() => toggleEnvelopeFilter(savingsEnvelope.id)}
                  title={savingsEnvelope.name}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all border bg-[#0D0D0D] ${
                    activeEnvelopeFilters.has(savingsEnvelope.id)
                      ? ""
                      : "text-muted-foreground hover:opacity-90"
                  }`}
                  style={
                    activeEnvelopeFilters.has(savingsEnvelope.id)
                      ? {
                          borderColor: SAVINGS_GOLD_ACCENT,
                          color: SAVINGS_GOLD_ACCENT,
                          backgroundColor: `${SAVINGS_GOLD_ACCENT}18`,
                        }
                      : { borderColor: `${SAVINGS_GOLD_ACCENT}4D` }
                  }
                >
                  <PiggyBank className="h-3 w-3 shrink-0" aria-hidden />
                  <span>{savingsEnvelope.name}</span>
                </button>
                {discretionaryEnvelopes.length > 0 && (
                  <div className="h-6 w-px bg-white/10 mx-1" aria-hidden />
                )}
              </>
            )}
            {discretionaryEnvelopes.map((env) => {
              const active = activeEnvelopeFilters.has(env.id)
              return (
                <button
                  key={env.id}
                  type="button"
                  onClick={() => toggleEnvelopeFilter(env.id)}
                  title={env.name}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all border ${
                    active
                      ? "border-transparent"
                      : "bg-[#0D0D0D] border-[#1F1F1F] text-muted-foreground hover:border-[#333] hover:text-foreground"
                  }`}
                  style={active ? {
                    backgroundColor: `${env.color}22`,
                    borderColor: env.color,
                    color: env.color,
                  } : undefined}
                >
                  <EnvelopeIconDisplay
                    icon={env.icon}
                    fallbackName={env.name}
                    className="h-3 w-3 shrink-0 text-[8px]"
                  />
                  <span>{env.name}</span>
                </button>
              )
            })}
            {activeEnvelopeFilters.size > 0 && (
              <button
                type="button"
                data-testid="transactions-envelope-filter-clear"
                onClick={() => { setEnvelopeFilters(new Set()); setPage(1) }}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors ml-1"
              >
                Clear
              </button>
            )}
          </div>
        )}
        {savingsOnlyFilter && (
          <p className="text-xs text-muted-foreground px-1" role="status">
            Showing Savings transactions only — some entries move money into other envelopes.
          </p>
        )}
        {!historyReady && hasActiveFilter && (
          <p className="text-xs text-amber-400/90 px-1" role="status">
            Older transactions may still be loading — results are incomplete until sync finishes.
          </p>
        )}
      </div>

      {availableTags.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {availableTags.map((tag) => {
            const active = tagFilters.has(tag)
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTagFilter(tag)}
                className={`px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                  active
                    ? "bg-[#F7931A]/10 border-[#F7931A]/40 text-[#F7931A]"
                    : "bg-[#0D0D0D] border-[#1F1F1F] text-muted-foreground hover:border-[#333] hover:text-foreground"
                }`}
              >
                {tag}
              </button>
            )
          })}
          {tagFilters.size > 0 && (
            <button
              type="button"
              onClick={() => { setTagFilters(new Set()); setPage(1) }}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors ml-1"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {!scopedEnvelopeId && <UpcomingRecurringTransactions />}

      <div className="bg-[#0D0D0D] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-muted-foreground text-xs uppercase tracking-wider border-b border-[#1F1F1F]">
                <th className="py-3 px-4 text-left font-medium">Date</th>
                <th className="py-3 px-4 text-left font-medium">Payee</th>
                <th className="py-3 px-4 text-left font-medium hidden md:table-cell">Envelope</th>
                <th className="py-3 px-4 text-left font-medium hidden sm:table-cell">Type</th>
                <th className="py-3 px-4 text-right font-medium">Amount (USD)</th>
                {state.opportunityCostEnabled && <th className="py-3 px-4 text-right font-medium hidden md:table-cell">Amount ({state.btcDisplayUnit === "sats" ? "sats" : "BTC"})</th>}
                {state.opportunityCostEnabled && <th className="py-3 px-4 text-right font-medium hidden sm:table-cell">Opportunity Cost</th>}
                <th className="py-3 px-4 text-right font-medium w-12"></th>
              </tr>
            </thead>
            <tbody>
              {paginatedRows.map((row) => {
                if (isRebalanceGroupRow(row)) {
                  const sign = row.savingsDeltaUsd >= 0 ? "+" : "−"
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-[#1A1A1A] last:border-0 transition-colors group hover:bg-[#111]"
                    >
                      <td className="whitespace-nowrap px-4 py-3.5 text-sm text-muted-foreground">
                        {formatTransactionTableDate(row.date)}
                      </td>
                      <td className="px-4 py-3.5 text-sm font-medium text-foreground">
                        Rebalanced {row.envelopeCount} envelope{row.envelopeCount === 1 ? "" : "s"} · {sign}
                        {formatUsd(Math.abs(row.savingsDeltaUsd))} to Savings
                      </td>
                      <td className="hidden px-4 py-3.5 md:table-cell">
                        <span className="text-sm text-muted-foreground">—</span>
                      </td>
                      <td className="hidden px-4 py-3.5 sm:table-cell">
                        <Badge variant="outline" className={REBALANCE_TYPE_BADGE_CLASS}>
                          Rebalance
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5 text-right text-sm text-muted-foreground">—</td>
                      {state.opportunityCostEnabled && (
                        <td className="hidden px-4 py-3.5 text-right text-sm text-muted-foreground md:table-cell">
                          —
                        </td>
                      )}
                      {state.opportunityCostEnabled && (
                        <td className="hidden px-4 py-3.5 text-right text-sm text-muted-foreground sm:table-cell">
                          —
                        </td>
                      )}
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100">
                          <button
                            type="button"
                            className="px-1 text-xs text-[#3B82F6] hover:underline"
                            onClick={() => {
                              setRebalanceEditBatchId(row.fundingBatchId)
                              setRebalanceDialogOpen(true)
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="rounded p-1 text-muted-foreground hover:bg-[#1F1F1F] hover:text-[#EF4444]"
                            aria-label="Delete rebalance"
                            onClick={() => {
                              const leg = activeTransactions.find(
                                (t) => t.fundingBatchId === row.fundingBatchId,
                              )
                              if (leg) requestDelete(leg)
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                }

                const txn = row
                const opCost = calculateOpportunityCost(txn.amount, txn.date)
                const env = envelopeMap[txn.envelopeId]
                const isHighlighted = txn.id === highlightTransactionId
                const payeeLabel =
                  txn.isDecrypted === false
                    ? null
                    : displayPayeeForTransaction(txn, activeTransactions, incomeByFundingBatchId)
                const showIncomeEdit = txn.source === TX_SOURCE_IRREGULAR_INCOME && txn.type === "credit"
                return (
                  <tr
                    key={txn.id}
                    ref={isHighlighted ? highlightedRef : undefined}
                    className={`border-b border-[#1A1A1A] last:border-0 hover:bg-[#111] transition-colors group cursor-pointer${isHighlighted ? " bg-[#F7931A]/10" : ""}`}
                    onClick={() => setSelectedTxn(txn)}
                  >
                    <td className="py-3.5 px-4 text-sm text-muted-foreground whitespace-nowrap">
                      {formatTransactionTableDate(txn.date)}
                    </td>
                    <td className="py-3.5 px-4 text-sm font-medium text-foreground">
                      <div className="flex flex-col gap-1">
                        <span className="flex items-center gap-1.5">
                          {txn.isDecrypted === false ? (
                            <span className="text-muted-foreground italic">{ENCRYPTED_DISPLAY}</span>
                          ) : (
                            payeeLabel
                          )}
                          {txn.recurringId && (
                            <span title="Recurring transaction"><Repeat className="h-3 w-3 text-muted-foreground shrink-0" /></span>
                          )}
                        </span>
                        {txn.tags?.length ? (
                          <div className="flex flex-wrap gap-1">
                            {txn.tags.map((tag) => (
                              <span
                                key={tag}
                                className="px-2 py-0.5 rounded-full text-[11px] leading-4 bg-[#1A1A1A] border border-[#2A2A2A] text-muted-foreground"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
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
                          <BtcAmount sats={txn.satsAmount} unit={state.btcDisplayUnit} />
                        ) : (
                          "—"
                        )}
                      </td>
                    )}
                    {state.opportunityCostEnabled && (
                      <td className="py-3.5 px-4 text-right text-sm hidden sm:table-cell">
                        {txn.type === "expense" ? (
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <span
                              className={`font-semibold tabular-nums ${
                                opCost >= 0 ? "text-[#F7931A]" : "text-[#22C55E]"
                              }`}
                            >
                              {formatUsd(opCost)}
                            </span>
                            {txn.amount > 0 && (
                              <PriceGainLossBadge
                                gained={opCost >= 0}
                                percentChange={Math.abs((opCost / txn.amount) * 100)}
                              />
                            )}
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                    )}
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100">
                        {showIncomeEdit ? (
                          <button
                            type="button"
                            className="text-xs text-[#3B82F6] hover:underline px-1"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedTxn(txn)
                            }}
                          >
                            Edit
                          </button>
                        ) : null}
                        {canDeleteTransactionFromList(txn) ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              requestDelete(txn)
                            }}
                            className="p-1 rounded hover:bg-[#1F1F1F] text-muted-foreground hover:text-[#EF4444] transition-all"
                            aria-label={`Delete transaction ${txn.payee}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {paginatedRows.length === 0 && (
                <tr>
                  <td colSpan={state.opportunityCostEnabled ? 8 : 6} className="py-10 text-center text-muted-foreground text-sm">
                    {!historyReady && !hasActiveFilter
                      ? "Loading older transactions…"
                      : "No transactions found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-4 py-3 border-t border-[#1F1F1F]">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {displayRows.length > 0
                ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, displayRows.length)} of ${displayRows.length}`
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
          if (scopedEnvelopeId) {
            navigateTo("envelope-detail", incomeTxn.envelopeId)
            setSelectedTxn(incomeTxn)
            return
          }
          clearTransactionEnvelopeFilter()
          setEnvelopeFilters(new Set([incomeTxn.envelopeId]))
          setSelectedTxn(incomeTxn)
        }}
      />
      <RebalanceEnvelopesDialog
        open={rebalanceDialogOpen}
        onOpenChange={(open) => {
          setRebalanceDialogOpen(open)
          if (!open) setRebalanceEditBatchId(null)
        }}
        editBatchId={rebalanceEditBatchId}
      />
      {confirmDialog}
    </div>
  )
}
