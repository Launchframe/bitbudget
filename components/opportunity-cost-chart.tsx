"use client"

import { useMemo, useState, useCallback } from "react"
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend } from "recharts"
import { useApp } from "@/lib/app-context"
import { useBtcPrices } from "@/lib/btc-price-context"
import { formatUsd } from "@/lib/data"

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

export function OpportunityCostChart() {
  const { state } = useApp()
  const { getPriceOnDate, currentPrice } = useBtcPrices()
  const [activeRange, setActiveRange] = useState<RangeKey>("12m")
  const [startDate, setStartDate] = useState(() => getStartDateForRange("12m"))

  const selectRange = useCallback((key: RangeKey) => {
    setActiveRange(key)
    setStartDate(getStartDateForRange(key))
  }, [])

  const filteredData = useMemo(() => {
    if (!currentPrice || state.transactions.length === 0) return []

    const expenses = state.transactions
      .filter((t) => t.type === "expense" && t.date.split("T")[0] >= startDate)
      .sort((a, b) => a.date.localeCompare(b.date))

    if (expenses.length === 0) return []

    const dailyMap = new Map<string, { usd: number; sats: number }>()

    for (const txn of expenses) {
      const day = txn.date.split("T")[0]
      const entry = dailyMap.get(day) ?? { usd: 0, sats: 0 }
      entry.usd += txn.amount

      if (txn.satsAmount != null) {
        entry.sats += txn.satsAmount
      } else {
        const price = getPriceOnDate(day)
        if (price > 0) entry.sats += Math.round((txn.amount / price) * SATS_PER_BTC)
      }

      dailyMap.set(day, entry)
    }

    const sortedDays = Array.from(dailyMap.keys()).sort()

    let cumUsd = 0
    let cumSats = 0
    const points: { date: string; spent: number; btcValue: number }[] = []

    for (const day of sortedDays) {
      const { usd, sats } = dailyMap.get(day)!
      cumUsd += usd
      cumSats += sats

      const btcValue = (cumSats / SATS_PER_BTC) * currentPrice

      points.push({ date: day, spent: Math.round(cumUsd), btcValue: Math.round(btcValue) })
    }

    return points
  }, [state.transactions, currentPrice, getPriceOnDate, startDate])

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
      </div>

      {filteredData.length === 0 ? (
        <div className="h-[250px] md:h-[350px] flex items-center justify-center text-muted-foreground text-sm">
          No expense transactions to display.
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
                tick={{ fill: "#666", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                interval={Math.max(1, Math.floor(filteredData.length / 8))}
                tickFormatter={(val: string) => {
                  const d = new Date(val)
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
              <Legend
                verticalAlign="top"
                align="right"
                height={30}
                formatter={(value: string) => (
                  <span className="text-xs text-muted-foreground">{value}</span>
                )}
              />
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
