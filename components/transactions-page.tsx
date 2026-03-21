"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import { useApp } from "@/lib/app-context"
import { useBtcPrices } from "@/lib/btc-price-context"
import { formatUsd, formatUsdPrecise, formatBtcAmountFromSats, type TransactionType } from "@/lib/data"
import { buildExportFilename, buildTransactionsCsv } from "@/lib/transaction-export"
import type { Transaction } from "@/lib/data"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { EnvelopeIconDisplay } from "@/components/envelope-icon-display"
import { Search, ChevronLeft, ChevronRight, Trash2, Repeat, SlidersHorizontal, X, Plus, Download } from "lucide-react"
import { ENCRYPTED_DISPLAY } from "@/lib/encrypted-display"
import { Skeleton } from "@/components/ui/skeleton"
import { TransactionDetailDialog } from "@/components/transaction-detail-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

function BtcAmount({ value, unit, className }: { value: string; unit: string; className?: string }) {
  return <span className={`${unit === "btc" ? "font-ibm-plex-mono" : ""} ${className ?? ""}`}>{value}</span>
}

const PAGE_SIZE_OPTIONS = [10, 15, 25, 50, 100]
const MOBILE_PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

export function TransactionsPage() {
  const {
    state,
    activeEnvelopes,
    activeTransactions,
    deleteTransaction,
    highlightTransactionId,
    transactionEnvelopeFilter,
    clearTransactionEnvelopeFilter,
    openNewTransaction,
    loading,
  } = useApp()
  const { calculateOpportunityCost } = useBtcPrices()

  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState<"all" | TransactionType>("all")
  const [envelopeFilters, setEnvelopeFilters] = useState<Set<string>>(() => transactionEnvelopeFilter)
  const [tagFilters, setTagFilters] = useState<Set<string>>(() => new Set())
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [pageSize, setPageSize] = useState(15)
  const [page, setPage] = useState(1)
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false)
  const moreFiltersRef = useRef<HTMLDivElement>(null)
  const highlightedRef = useRef<HTMLTableRowElement>(null)

  useEffect(() => {
    if (transactionEnvelopeFilter.size > 0) clearTransactionEnvelopeFilter()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (moreFiltersRef.current && !moreFiltersRef.current.contains(e.target as Node)) {
        setMoreFiltersOpen(false)
      }
    }
    if (moreFiltersOpen) document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [moreFiltersOpen])

  const envelopeMap = useMemo(() => {
    const map: Record<string, { name: string; color: string; icon?: string | null }> = {}
    for (const e of state.envelopes) map[e.id] = { name: e.name, color: e.color, icon: e.icon }
    return map
  }, [state.envelopes])

  const availableTags = useMemo(() => {
    const tags = new Set<string>()
    for (const txn of activeTransactions) {
      for (const tag of txn.tags ?? []) tags.add(tag)
    }
    return Array.from(tags).sort((a, b) => a.localeCompare(b))
  }, [activeTransactions])

  const filteredTransactions = useMemo(() => {
    let result = activeTransactions

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter((t) => t.payee.toLowerCase().includes(q))
    }

    if (typeFilter !== "all") {
      result = result.filter((t) => t.type === typeFilter)
    }

    if (envelopeFilters.size > 0) {
      result = result.filter((t) => envelopeFilters.has(t.envelopeId))
    }

    if (tagFilters.size > 0) {
      result = result.filter((t) => t.tags?.some((tag) => tagFilters.has(tag)))
    }

    if (startDate) {
      result = result.filter((t) => t.date >= startDate)
    }
    if (endDate) {
      result = result.filter((t) => t.date <= endDate)
    }

    return result.sort((a, b) => b.date.localeCompare(a.date))
  }, [activeTransactions, searchQuery, typeFilter, envelopeFilters, tagFilters, startDate, endDate])

  useEffect(() => {
    if (!highlightTransactionId) return
    const idx = filteredTransactions.findIndex(t => t.id === highlightTransactionId)
    if (idx === -1) return
    const targetPage = Math.floor(idx / pageSize) + 1
    if (targetPage !== page) setPage(targetPage)
  }, [highlightTransactionId, filteredTransactions, pageSize]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (highlightTransactionId && highlightedRef.current) {
      highlightedRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [highlightTransactionId, page])

  const totalPages = Math.max(1, Math.ceil(filteredTransactions.length / pageSize))
  const paginatedTransactions = filteredTransactions.slice((page - 1) * pageSize, page * pageSize)

  const expenseTxns = filteredTransactions.filter(t => t.type === "expense")
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

  const hasActiveFilter = searchQuery.trim() || typeFilter !== "all" || envelopeFilters.size > 0 || tagFilters.size > 0 || startDate || endDate

  function toggleEnvelopeFilter(id: string) {
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
      envelopeFilters.size > 0
        ? Array.from(envelopeFilters).map((id) => envelopeMap[id]?.name ?? id)
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
      <div className="flex flex-col gap-1 p-4 md:p-6 bg-[#0D0D0D] rounded-2xl">
        <h2 className="text-xl font-semibold text-foreground">All Transactions</h2>
        <div className="flex flex-wrap items-center gap-4 md:gap-6 mt-2">
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
                  value={formatBtcAmountFromSats(totalSats, state.btcDisplayUnit)}
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
        <div className="self-start flex items-center gap-2 mt-3">
          <button
            onClick={() => openNewTransaction()}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Transaction
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#0D0D0D] text-foreground rounded-xl font-semibold text-sm hover:bg-[#1A1A1A] transition-colors border border-[#333]"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
        </div>
      </div>

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
                  <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v as "all" | TransactionType); setPage(1) }}>
                    <SelectTrigger className="bg-[#0D0D0D] border-[#333] text-foreground w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#1A1A1A] border-[#333]">
                      <SelectItem value="all" className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">All Types</SelectItem>
                      <SelectItem value="expense" className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">Expenses</SelectItem>
                      <SelectItem value="credit" className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">Credits</SelectItem>
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
        {activeEnvelopes.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {activeEnvelopes.map((env) => {
              const active = envelopeFilters.has(env.id)
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
            {envelopeFilters.size > 0 && (
              <button
                type="button"
                onClick={() => { setEnvelopeFilters(new Set()); setPage(1) }}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors ml-1"
              >
                Clear
              </button>
            )}
          </div>
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
              {loading ? (
                Array.from({ length: pageSize }).map((_, i) => (
                  <tr key={`sk-${i}`} className="border-b border-[#1A1A1A]">
                    <td className="py-3.5 px-4"><Skeleton className="h-4 w-24 bg-[#1A1A1A]" /></td>
                    <td className="py-3.5 px-4"><Skeleton className="h-4 w-40 bg-[#1A1A1A]" /></td>
                    <td className="py-3.5 px-4 hidden md:table-cell"><Skeleton className="h-4 w-28 bg-[#1A1A1A]" /></td>
                    <td className="py-3.5 px-4 hidden sm:table-cell"><Skeleton className="h-6 w-16 bg-[#1A1A1A]" /></td>
                    <td className="py-3.5 px-4 text-right"><Skeleton className="h-4 w-16 ml-auto bg-[#1A1A1A]" /></td>
                    {state.opportunityCostEnabled && (
                      <td className="py-3.5 px-4 text-right hidden md:table-cell"><Skeleton className="h-4 w-14 ml-auto bg-[#1A1A1A]" /></td>
                    )}
                    {state.opportunityCostEnabled && (
                      <td className="py-3.5 px-4 text-right hidden sm:table-cell"><Skeleton className="h-4 w-14 ml-auto bg-[#1A1A1A]" /></td>
                    )}
                    <td className="py-3.5 px-4" />
                  </tr>
                ))
              ) : paginatedTransactions.map((txn) => {
                const opCost = calculateOpportunityCost(txn.amount, txn.date)
                const env = envelopeMap[txn.envelopeId]
                const isHighlighted = txn.id === highlightTransactionId
                return (
                  <tr
                    key={txn.id}
                    ref={isHighlighted ? highlightedRef : undefined}
                    className={`border-b border-[#1A1A1A] last:border-0 hover:bg-[#111] transition-colors group cursor-pointer${isHighlighted ? " bg-[#F7931A]/10" : ""}`}
                    onClick={() => setSelectedTxn(txn)}
                  >
                    <td className="py-3.5 px-4 text-sm text-muted-foreground whitespace-nowrap">
                      {new Date(txn.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td className="py-3.5 px-4 text-sm font-medium text-foreground">
                      <div className="flex flex-col gap-1">
                        <span className="flex items-center gap-1.5">
                          {txn.isDecrypted === false ? (
                            <span className="text-muted-foreground italic">{ENCRYPTED_DISPLAY}</span>
                          ) : (
                            txn.payee
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
                    {state.opportunityCostEnabled && (
                      <td className="py-3.5 px-4 text-right text-sm text-muted-foreground hidden md:table-cell">
                        {txn.satsAmount != null ? <BtcAmount value={formatBtcAmountFromSats(txn.satsAmount, state.btcDisplayUnit)} unit={state.btcDisplayUnit} /> : "—"}
                      </td>
                    )}
                    {state.opportunityCostEnabled && (
                      <td className="py-3.5 px-4 text-right text-sm font-semibold text-[#F7931A] hidden sm:table-cell">
                        {txn.type === "expense" ? formatUsd(opCost) : "—"}
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
              {!loading && paginatedTransactions.length === 0 && (
                <tr>
                  <td colSpan={state.opportunityCostEnabled ? 8 : 6} className="py-10 text-center text-muted-foreground text-sm">
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
      />
    </div>
  )
}
