"use client"

import { useMemo, useState, useCallback, useEffect } from "react"
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend } from "recharts"
import { useApp } from "@/lib/app-context"
import { useBtcPrices } from "@/lib/btc-price-context"
import { formatUsd } from "@/lib/data"
import { Info, BarChart3 } from "lucide-react"

type RangeKey = "mtd" | "1m" | "3m" | "12m" | "ytd" | "5y" | "all"

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
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    setMobile(mql.matches)
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches)
    mql.addEventListener("change", handler)
    return () => mql.removeEventListener("change", handler)
  }, [breakpoint])
  return mobile
}

export function OpportunityCostChart() {
  const { state, activeTransactions } = useApp()
  const { getPriceOnDate, currentPrice, priceHistory } = useBtcPrices()
  const [activeRange, setActiveRange] = useState<RangeKey>("12m")
  const [startDate, setStartDate] = useState(() => getStartDateForRange("12m"))
  const isMobile = useIsMobile()

  const selectRange = useCallback((key: RangeKey) => {
    setActiveRange(key)
    setStartDate(getStartDateForRange(key))
  }, [])

  const hasAnyExpenses = useMemo(
    () => activeTransactions.some((t) => t.type === "expense"),
    [activeTransactions],
  )

  const filteredData = useMemo(() => {
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
  }, [activeTransactions, currentPrice, priceHistory, getPriceOnDate, startDate])

  const yDomain = useMemo(() => {
    if (filteredData.length === 0) return [0, 100]
    const allVals = filteredData.flatMap((d) => [d.spent, d.btcValue])
    const max = Math.max(...allVals)
    return [0, Math.ceil(max * 1.1)]
  }, [filteredData])

  const spread = useMemo(() => {
    if (filteredData.length === 0) return null
    const last = filteredData[filteredData.length - 1]
    const diff = last.btcValue - last.spent
    const pct = last.spent > 0 ? ((diff / last.spent) * 100).toFixed(0) : "0"
    return { spent: last.spent, btcValue: last.btcValue, diff, pct }
  }, [filteredData])

  const earliestTxnDate = useMemo(() => {
    if (activeTransactions.length === 0) return null
    const sorted = activeTransactions
      .filter(t => t.type === "expense")
      .map(t => t.date.split("T")[0])
      .sort()
    return sorted[0] ?? null
  }, [activeTransactions])

  const earliestFormatted = useMemo(() => {
    if (!earliestTxnDate) return null
    return new Date(earliestTxnDate + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
  }, [earliestTxnDate])

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 bg-[#0D0D0D] rounded-2xl">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-foreground">Opportunity Cost</h2>

          {spread && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="text-muted-foreground">
                Spent: <span className="text-foreground font-medium">{formatUsd(spread.spent)}</span>
              </span>
              <span className="text-muted-foreground">
                BTC value: <span className="text-[#F7931A] font-medium">{formatUsd(spread.btcValue)}</span>
              </span>
              <span className={`font-semibold ${spread.diff >= 0 ? "text-[#F7931A]" : "text-[#22C55E]"}`}>
                {spread.diff >= 0 ? "+" : ""}{spread.pct}%
              </span>
            </div>
          )}
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
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {activeRange === "all" && earliestFormatted && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground leading-relaxed">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Although Bitcoin has been running without interruption since 2010, your transaction history begins on {earliestFormatted}.
            </span>
          </div>
        )}
      </div>

      {filteredData.length < 3 ? (
        <div className="h-[250px] md:h-[350px] flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <BarChart3 className="h-8 w-8 text-[#333]" />
          <p className="text-sm text-center max-w-xs">
            {activeTransactions.length === 0
              ? "Add more transactions to see your opportunity cost trends."
              : !hasAnyExpenses
                ? "No expense transactions to display."
                : "No expense transactions to display in this timeframe."
            }
          </p>
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
                tickFormatter={(val: string) => {
                  const d = new Date(val)
                  const yearOnly = activeRange === "5y" || activeRange === "all"
                  if (yearOnly) return d.getFullYear().toString()
                  if (isMobile) return d.toLocaleDateString("en-US", { month: "short" })
                  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
                }}
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
                  if (active && payload && payload.length >= 2) {
                    const point = payload[0].payload
                    const diff = point.btcValue - point.spent
                    const pct = point.spent > 0 ? ((diff / point.spent) * 100).toFixed(1) : "0"
                    return (
                      <div className="bg-[#1A1A1A] border border-[#333] p-3 rounded-lg shadow-xl">
                        <p className="text-xs text-muted-foreground mb-2">{point.date}</p>
                        <div className="flex flex-col gap-1">
                          <p className="text-sm">
                            <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#888] mr-2" />
                            <span className="text-muted-foreground">Spent: </span>
                            <span className="text-foreground font-medium">{formatUsd(point.spent)}</span>
                          </p>
                          <p className="text-sm">
                            <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#F7931A] mr-2" />
                            <span className="text-muted-foreground">BTC value: </span>
                            <span className="text-[#F7931A] font-medium">{formatUsd(point.btcValue)}</span>
                          </p>
                          <p className="text-xs text-muted-foreground mt-1 border-t border-[#333] pt-1">
                            Difference: <span className={`font-medium ${diff >= 0 ? "text-[#F7931A]" : "text-[#22C55E]"}`}>
                              {diff >= 0 ? "+" : ""}{formatUsd(diff)} ({diff >= 0 ? "+" : ""}{pct}%)
                            </span>
                          </p>
                        </div>
                      </div>
                    )
                  }
                  return null
                }}
              />
              {!isMobile && (
                <Legend
                  verticalAlign="top"
                  align="right"
                  height={30}
                  formatter={(value: string) => (
                    <span className="text-xs text-muted-foreground">{value}</span>
                  )}
                />
              )}
              <Area
                type="monotone"
                dataKey="spent"
                name="Cumulative Spent (USD)"
                stroke="#888"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorSpent)"
              />
              <Area
                type="monotone"
                dataKey="btcValue"
                name="Equivalent BTC Savings"
                stroke="#F7931A"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorBtcValue)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
