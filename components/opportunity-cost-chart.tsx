"use client"

import { useMemo, useState, useCallback, useSyncExternalStore, useEffect } from "react"
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend } from "recharts"
import { useApp } from "@/lib/app-context"
import { useBtcPrices } from "@/lib/btc-price-context"
import { formatUsd } from "@/lib/data"
import { findSavingsEnvelope, isSavingsInflowCredit } from "@/lib/savings-ui-metrics"
import {
  getDashboardChartMode,
  setDashboardChartMode,
  subscribeDashboardChartMode,
  type DashboardChartMode,
} from "@/lib/dashboard-chart-mode"
import { SAVINGS_GOLD_ACCENT, SAVINGS_EXPERIENCE_DISMISSED } from "@/lib/constants"
// Shared tick rules (incl. short spans / 5Y imported history) live in `lib/chart-x-axis-format.ts`.
import { formatExpenseChartXAxisTick } from "@/lib/chart-x-axis-format"
import { BarChart3 } from "lucide-react"
import { PriceGainLossBadge } from "@/components/price-gain-loss-badge"

type RangeKey = "mtd" | "1m" | "3m" | "12m" | "ytd" | "5y" | "all"
type ChartMode = DashboardChartMode

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "mtd", label: "MTD" },
  { key: "1m", label: "1M" },
  { key: "3m", label: "3M" },
  { key: "12m", label: "12M" },
  { key: "ytd", label: "YTD" },
  { key: "5y", label: "5Y" },
  { key: "all", label: "All" },
]

function getStartDateForRange(key: RangeKey): string {
  const d = new Date()
  switch (key) {
    case "mtd": return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
    case "1m": d.setMonth(d.getMonth() - 1); break
    case "3m": d.setMonth(d.getMonth() - 3); break
    case "12m": d.setFullYear(d.getFullYear() - 1); break
    case "ytd": return `${d.getFullYear()}-01-01`
    case "5y": d.setFullYear(d.getFullYear() - 5); break
    case "all": return "2009-01-03"
  }
  return d.toISOString().split("T")[0]
}

const SATS_PER_BTC = 100_000_000

function useIsMobile(breakpoint = 640) {
  const query = useMemo(() => `(max-width: ${breakpoint - 1}px)`, [breakpoint])

  const mediaQueryList = useMemo(() => {
    if (typeof window === "undefined") {
      return null
    }
    return window.matchMedia(query)
  }, [query])

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!mediaQueryList) {
        return () => {}
      }
      mediaQueryList.addEventListener("change", onChange)
      return () => {
        mediaQueryList.removeEventListener("change", onChange)
      }
    },
    [mediaQueryList],
  )

  const getSnapshot = useCallback(() => {
    if (!mediaQueryList) {
      return false
    }
    return mediaQueryList.matches
  }, [mediaQueryList])

  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => false,
  )
}

export function OpportunityCostChart() {
  const { activeTransactions, state } = useApp()
  const { getPriceOnDate, currentPrice, priceHistory } = useBtcPrices()
  const [activeRange, setActiveRange] = useState<RangeKey>("12m")
  const chartMode = useSyncExternalStore(
    subscribeDashboardChartMode,
    getDashboardChartMode,
    () => "spending" as ChartMode,
  )
  const setChartMode = useCallback((mode: ChartMode) => {
    setDashboardChartMode(mode)
  }, [])
  const [startDate, setStartDate] = useState(() => getStartDateForRange("12m"))
  const isMobile = useIsMobile()
  const ocEnabled = state.opportunityCostEnabled

  const selectRange = useCallback((key: RangeKey) => {
    setActiveRange(key)
    setStartDate(getStartDateForRange(key))
  }, [])

  const savingsEnvelope = useMemo(
    () => findSavingsEnvelope(state.envelopes),
    [state.envelopes],
  )

  const savingsChartEnabled =
    state.savingsExperience !== SAVINGS_EXPERIENCE_DISMISSED && savingsEnvelope != null
  const effectiveChartMode: ChartMode = savingsChartEnabled ? chartMode : "spending"

  useEffect(() => {
    if (!savingsChartEnabled && chartMode === "savings") {
      setDashboardChartMode("spending")
    }
  }, [savingsChartEnabled, chartMode])

  useEffect(() => {
    try {
      const override = sessionStorage.getItem("dashboard-chart-range-override")
      if (override === "all") {
        sessionStorage.removeItem("dashboard-chart-range-override")
        setTimeout(() => selectRange("all"), 0)
      }
    } catch {
      /* ignore */
    }
  }, [selectRange])

  const hasAnyExpenses = useMemo(
    () => activeTransactions.some((t) => t.type === "expense"),
    [activeTransactions],
  )

  const hasAnySavingsInflows = useMemo(() => {
    if (!savingsEnvelope) return false
    return activeTransactions.some(
      (t) => isSavingsInflowCredit(t, savingsEnvelope.id) && t.date.split("T")[0] >= startDate,
    )
  }, [activeTransactions, savingsEnvelope, startDate])

  // Full OC data (spent + btcValue) — only computed when OC is enabled
  const ocData = useMemo(() => {
    if (!ocEnabled) return []
    if (!currentPrice || activeTransactions.length === 0 || priceHistory.length === 0) return []

    const expenses = activeTransactions
      .filter((t) => t.type === "expense" && t.date.split("T")[0] >= startDate)
      .sort((a, b) => a.date.localeCompare(b.date))

    if (expenses.length === 0) return []

    const dailyTxns = new Map<string, { usd: number; sats: number }>()
    for (const txn of expenses) {
      const day = txn.date.split("T")[0]
      const entry = dailyTxns.get(day) ?? { usd: 0, sats: 0 }
      entry.usd += txn.amount
      if (txn.satsAmount != null) {
        entry.sats += txn.satsAmount
      } else {
        const price = getPriceOnDate(day)
        if (price > 0) entry.sats += Math.round((txn.amount / price) * SATS_PER_BTC)
      }
      dailyTxns.set(day, entry)
    }

    const txnDays = Array.from(dailyTxns.keys()).sort()
    const firstTxnDate = txnDays[0]
    const today = new Date().toISOString().split("T")[0]

    const priceDates = priceHistory
      .filter(p => p.date >= firstTxnDate && p.date <= today)
      .map(p => p.date)

    const allDates = new Set([...priceDates, ...txnDays])
    const sortedDates = Array.from(allDates).sort()

    let cumUsd = 0
    let cumSats = 0
    let txnIdx = 0
    const points: { date: string; spent: number; btcValue: number }[] = []

    for (const day of sortedDates) {
      while (txnIdx < txnDays.length && txnDays[txnIdx] <= day) {
        const d = dailyTxns.get(txnDays[txnIdx])!
        cumUsd += d.usd
        cumSats += d.sats
        txnIdx++
      }
      const priceOnDay = getPriceOnDate(day)
      const btcValue = (cumSats / SATS_PER_BTC) * priceOnDay
      points.push({ date: day, spent: Math.round(cumUsd), btcValue: Math.round(btcValue) })
    }

    return points
  }, [ocEnabled, activeTransactions, currentPrice, priceHistory, getPriceOnDate, startDate])

  const savingsOcData = useMemo(() => {
    if (!ocEnabled || effectiveChartMode !== "savings") return []
    if (!savingsEnvelope || !currentPrice || activeTransactions.length === 0 || priceHistory.length === 0) {
      return []
    }

    const credits = activeTransactions
      .filter(
        (t) =>
          isSavingsInflowCredit(t, savingsEnvelope.id) &&
          t.date.split("T")[0] >= startDate,
      )
      .sort((a, b) => a.date.localeCompare(b.date))

    if (credits.length === 0) return []

    const dailyTxns = new Map<string, { usd: number; sats: number }>()
    for (const txn of credits) {
      const day = txn.date.split("T")[0]
      const entry = dailyTxns.get(day) ?? { usd: 0, sats: 0 }
      entry.usd += txn.amount
      if (txn.satsAmount != null) {
        entry.sats += txn.satsAmount
      } else {
        const price = getPriceOnDate(day)
        if (price > 0) entry.sats += Math.round((txn.amount / price) * SATS_PER_BTC)
      }
      dailyTxns.set(day, entry)
    }

    const txnDays = Array.from(dailyTxns.keys()).sort()
    const firstTxnDate = txnDays[0]
    const today = new Date().toISOString().split("T")[0]

    const priceDates = priceHistory
      .filter((p) => p.date >= firstTxnDate && p.date <= today)
      .map((p) => p.date)

    const allDates = new Set([...priceDates, ...txnDays])
    const sortedDates = Array.from(allDates).sort()

    let cumUsd = 0
    let cumSats = 0
    let txnIdx = 0
    const points: { date: string; spent: number; btcValue: number }[] = []

    for (const day of sortedDates) {
      while (txnIdx < txnDays.length && txnDays[txnIdx] <= day) {
        const d = dailyTxns.get(txnDays[txnIdx])!
        cumUsd += d.usd
        cumSats += d.sats
        txnIdx++
      }
      const priceOnDay = getPriceOnDate(day)
      const btcValue = (cumSats / SATS_PER_BTC) * priceOnDay
      points.push({ date: day, spent: Math.round(cumUsd), btcValue: Math.round(btcValue) })
    }

    return points
  }, [ocEnabled, effectiveChartMode, activeTransactions, savingsEnvelope, currentPrice, priceHistory, getPriceOnDate, startDate])

  // Vanilla data — cumulative spent only, no BTC prices required
  const vanillaData = useMemo(() => {
    if (ocEnabled) return []

    const expenses = activeTransactions
      .filter((t) => t.type === "expense" && t.date.split("T")[0] >= startDate)
      .sort((a, b) => a.date.localeCompare(b.date))

    if (expenses.length === 0) return []

    const dailyUsd = new Map<string, number>()
    for (const txn of expenses) {
      const day = txn.date.split("T")[0]
      dailyUsd.set(day, (dailyUsd.get(day) ?? 0) + txn.amount)
    }

    const days = Array.from(dailyUsd.keys()).sort()
    let cumUsd = 0
    return days.map(day => {
      cumUsd += dailyUsd.get(day)!
      return { date: day, spent: Math.round(cumUsd), btcValue: 0 }
    })
  }, [ocEnabled, activeTransactions, startDate])

  const savingsVanillaData = useMemo(() => {
    if (ocEnabled || effectiveChartMode !== "savings" || !savingsEnvelope) return []

    const credits = activeTransactions
      .filter(
        (t) =>
          isSavingsInflowCredit(t, savingsEnvelope.id) &&
          t.date.split("T")[0] >= startDate,
      )
      .sort((a, b) => a.date.localeCompare(b.date))

    if (credits.length === 0) return []

    const dailyUsd = new Map<string, number>()
    for (const txn of credits) {
      const day = txn.date.split("T")[0]
      dailyUsd.set(day, (dailyUsd.get(day) ?? 0) + txn.amount)
    }

    const days = Array.from(dailyUsd.keys()).sort()
    let cumUsd = 0
    return days.map((day) => {
      cumUsd += dailyUsd.get(day)!
      return { date: day, spent: Math.round(cumUsd), btcValue: 0 }
    })
  }, [ocEnabled, effectiveChartMode, activeTransactions, savingsEnvelope, startDate])

  const filteredData =
    effectiveChartMode === "savings"
      ? ocEnabled
        ? savingsOcData
        : savingsVanillaData
      : ocEnabled
        ? ocData
        : vanillaData

  const yDomain = useMemo(() => {
    if (filteredData.length === 0) return [0, 100]
    const allVals = ocEnabled
      ? filteredData.flatMap((d) => [d.spent, d.btcValue])
      : filteredData.map(d => d.spent)
    const max = Math.max(...allVals)
    return [0, Math.ceil(max * 1.1)]
  }, [filteredData, ocEnabled])

  const xAxisTickFormatter = useCallback(
    (val: string) => {
      if (filteredData.length === 0) return val
      return formatExpenseChartXAxisTick(val, {
        activeRange,
        dataFirstIso: filteredData[0].date,
        dataLastIso: filteredData[filteredData.length - 1].date,
      })
    },
    [activeRange, filteredData],
  )

  const spread = useMemo(() => {
    if (filteredData.length === 0) return null
    const last = filteredData[filteredData.length - 1]
    if (!ocEnabled) return { spent: last.spent, btcValue: 0, diff: 0 }
    const diff = last.btcValue - last.spent
    return { spent: last.spent, btcValue: last.btcValue, diff }
  }, [filteredData, ocEnabled])

  const title =
    effectiveChartMode === "savings"
      ? ocEnabled
        ? "Cumulative Savings"
        : "Your savings"
      : ocEnabled
        ? "Opportunity Cost"
        : "Your expenses"

  const emptyMessage =
    effectiveChartMode === "savings"
      ? activeTransactions.length === 0
        ? "Add transactions to see your savings trends."
        : !hasAnySavingsInflows
          ? "No savings inflows to display."
          : "No savings inflows in this timeframe."
      : activeTransactions.length === 0
        ? "Add transactions to see your spending trends."
        : !hasAnyExpenses
          ? "No expense transactions to display."
          : "No expense transactions in this timeframe."

  const spentLabel = effectiveChartMode === "savings" ? "Saved" : "Spent"
  const btcLineName = effectiveChartMode === "savings" ? "Equivalent BTC Savings" : "Equivalent BTC Savings"
  const areaStroke = effectiveChartMode === "savings" ? SAVINGS_GOLD_ACCENT : "#888"

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 bg-[#0D0D0D] rounded-2xl">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-foreground">{title}</h2>

          <div className="flex flex-wrap items-center gap-2">
            {savingsChartEnabled && (
              <div
                className="flex items-center gap-1 bg-[#1A1A1A] rounded-lg p-1"
                role="group"
                aria-label="Chart mode"
              >
                <button
                  type="button"
                  onClick={() => setChartMode("spending")}
                  aria-pressed={effectiveChartMode === "spending"}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    effectiveChartMode === "spending"
                      ? "bg-[#F7931A] text-[#0D0D0D]"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Spending
                </button>
                <button
                  type="button"
                  onClick={() => setChartMode("savings")}
                  aria-pressed={effectiveChartMode === "savings"}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    effectiveChartMode === "savings"
                      ? "text-[#0D0D0D]"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  style={
                    effectiveChartMode === "savings"
                      ? { backgroundColor: SAVINGS_GOLD_ACCENT }
                      : undefined
                  }
                >
                  Savings
                </button>
              </div>
            )}

          {spread && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="text-muted-foreground">
                {spentLabel}: <span className="text-foreground font-medium">{formatUsd(spread.spent)}</span>
              </span>
              {ocEnabled && (
                <span className="text-muted-foreground inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>
                    BTC value:{" "}
                    <span className="text-[#F7931A] font-medium">{formatUsd(spread.btcValue)}</span>
                  </span>
                  <PriceGainLossBadge
                    gained={spread.diff >= 0}
                    percentChange={
                      spread.spent > 0 ? Math.abs((spread.diff / spread.spent) * 100) : 0
                    }
                  />
                </span>
              )}
            </div>
          )}
          </div>
        </div>

        <div className="flex items-center gap-1 bg-[#1A1A1A] rounded-lg p-1 w-fit overflow-x-auto no-scrollbar">
          {RANGE_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => selectRange(key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeRange === key
                  ? "bg-[#F7931A] text-[#0D0D0D]"
                  : "text-muted-foreground hover:text-foreground"
              } ${key === "3m" ? "hidden xs:block" : ""}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {filteredData.length < 3 ? (
        <div className="h-[250px] md:h-[350px] flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <BarChart3 className="h-8 w-8 text-[#333]" />
          <p className="text-sm text-center max-w-xs">{emptyMessage}</p>
        </div>
      ) : (
        <div className="h-[250px] md:h-[350px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={filteredData}>
              <defs>
                <linearGradient id="colorSpent" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#666" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#666" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorBtcValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#F7931A" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#F7931A" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1F1F1F" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: "#666", fontSize: isMobile ? 10 : 11 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                tickCount={isMobile ? 5 : 8}
                minTickGap={isMobile ? 40 : 50}
                tickFormatter={xAxisTickFormatter}
              />
              <YAxis
                domain={yDomain}
                orientation="right"
                tick={{ fill: "#666", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(val: number) =>
                  val >= 1_000_000 ? `$${(val / 1_000_000).toFixed(1)}M`
                    : val >= 1000 ? `$${(val / 1000).toFixed(0)}k`
                    : `$${val}`
                }
                width={65}
                hide={isMobile}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const point = payload[0].payload
                  return (
                    <div className="bg-[#1A1A1A] border border-[#333] p-3 rounded-lg shadow-xl">
                      <p className="text-xs text-muted-foreground mb-2">{point.date}</p>
                      <div className="flex flex-col gap-1">
                        <p className="text-sm">
                          <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#888] mr-2" />
                          <span className="text-muted-foreground">{spentLabel}: </span>
                          <span className="text-foreground font-medium">{formatUsd(point.spent)}</span>
                        </p>
                        {ocEnabled && (
                          <>
                            <p className="text-sm">
                              <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#F7931A] mr-2" />
                              <span className="text-muted-foreground">BTC value: </span>
                              <span className="text-[#F7931A] font-medium">{formatUsd(point.btcValue)}</span>
                            </p>
                            {(() => {
                              const diff = point.btcValue - point.spent
                              const pct = point.spent > 0 ? ((diff / point.spent) * 100).toFixed(1) : "0"
                              return (
                                <p className="text-xs text-muted-foreground mt-1 border-t border-[#333] pt-1">
                                  Difference: <span className={`font-medium ${diff >= 0 ? "text-[#F7931A]" : "text-[#22C55E]"}`}>
                                    {diff >= 0 ? "+" : ""}{formatUsd(diff)} ({diff >= 0 ? "+" : ""}{pct}%)
                                  </span>
                                </p>
                              )
                            })()}
                          </>
                        )}
                      </div>
                    </div>
                  )
                }}
              />
              {ocEnabled && !isMobile && (
                <Legend
                  verticalAlign="top"
                  align="center"
                  height={30}
                  formatter={(value: string) => (
                    <span className="text-xs text-muted-foreground">{value}</span>
                  )}
                />
              )}
              <Area
                type="monotone"
                dataKey="spent"
                name={effectiveChartMode === "savings" ? "Cumulative Saved (USD)" : "Cumulative Spent (USD)"}
                stroke={areaStroke}
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorSpent)"
              />
              {ocEnabled && (
                <Area
                  type="monotone"
                  dataKey="btcValue"
                  name={btcLineName}
                  stroke={effectiveChartMode === "savings" ? SAVINGS_GOLD_ACCENT : "#F7931A"}
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorBtcValue)"
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
