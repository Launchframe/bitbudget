"use client"

import { useState, useMemo, useCallback } from "react"
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts"
import { useBtcPrices } from "@/lib/btc-price-context"
import { formatUsd, formatNumber } from "@/lib/data"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

type RangeKey = "30d" | "3m" | "12m" | "ytd" | "5y" | "all"

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "30d", label: "30D" },
  { key: "3m", label: "3M" },
  { key: "12m", label: "12M" },
  { key: "ytd", label: "YTD" },
  { key: "5y", label: "5Y" },
  { key: "all", label: "All" },
]

function getStartDateForRange(key: RangeKey): string {
  const d = new Date()
  switch (key) {
    case "30d": d.setDate(d.getDate() - 30); break
    case "3m": d.setMonth(d.getMonth() - 3); break
    case "12m": d.setFullYear(d.getFullYear() - 1); break
    case "ytd": return `${d.getFullYear()}-01-01`
    case "5y": d.setFullYear(d.getFullYear() - 5); break
    case "all": return "2009-01-03"
  }
  return d.toISOString().split("T")[0]
}

export function BtcPriceChart() {
  const [showSats, setShowSats] = useState(false)
  const [activeRange, setActiveRange] = useState<RangeKey>("12m")
  const [startDate, setStartDate] = useState(() => getStartDateForRange("12m"))
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0])

  const { priceHistory, backfillStatus } = useBtcPrices()

  const selectRange = useCallback((key: RangeKey) => {
    setActiveRange(key)
    setStartDate(getStartDateForRange(key))
    setEndDate(new Date().toISOString().split("T")[0])
  }, [])

  const filteredData = useMemo(() => {
    return priceHistory
      .filter((p) => p.date >= startDate && p.date <= endDate)
      .map((p) => ({
        date: p.date,
        value: showSats ? Math.round(100_000_000 / p.price) : p.price,
        btcPrice: p.price,
      }))
  }, [priceHistory, startDate, endDate, showSats])

  const yDomain = useMemo(() => {
    if (filteredData.length === 0) return [0, 100]
    const values = filteredData.map((d) => d.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const pad = (max - min) * 0.1
    return [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)]
  }, [filteredData])

  const xTickFormat = useCallback((val: string) => {
    const d = new Date(val)
    if (activeRange === "30d") {
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    }
    return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
  }, [activeRange])

  return (
    <div className="flex flex-col gap-5 p-6 bg-[#0D0D0D] rounded-2xl">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-foreground">BTC Price</h2>
            <span className="text-sm text-muted-foreground px-2 py-0.5 bg-[#1A1A1A] rounded-full">
              {showSats ? "Sats/$" : "BTC/USD"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Label htmlFor="sats-toggle" className="text-xs text-muted-foreground cursor-pointer">BTC/USD</Label>
            <Switch
              id="sats-toggle"
              checked={showSats}
              onCheckedChange={setShowSats}
              className="data-[state=checked]:bg-[#F7931A]"
            />
            <Label htmlFor="sats-toggle" className="text-xs text-muted-foreground cursor-pointer">Sats/$</Label>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-[#1A1A1A] rounded-lg p-1 w-fit">
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
          {backfillStatus === "in_progress" && (
            <span className="text-xs text-muted-foreground animate-pulse">Loading history…</span>
          )}
        </div>
      </div>

      <div className="h-[350px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={filteredData}>
            <defs>
              <linearGradient id="colorBtc" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#F7931A" stopOpacity={0.3} />
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
              tickFormatter={xTickFormat}
            />
            <YAxis
              domain={yDomain}
              orientation="right"
              tick={{ fill: "#666", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(val: number) =>
                showSats ? formatNumber(val) : val >= 1000 ? `$${(val / 1000).toFixed(0)}k` : `$${val}`
              }
              width={60}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const point = payload[0].payload
                  return (
                    <div className="bg-[#1A1A1A] border border-[#333] p-3 rounded-lg shadow-xl">
                      <p className="text-xs text-muted-foreground mb-1">{point.date}</p>
                      {showSats ? (
                        <p className="text-foreground font-semibold">
                          {formatNumber(point.value)} <span className="text-muted-foreground text-sm">sats/$</span>
                        </p>
                      ) : (
                        <p className="text-foreground font-semibold">
                          {formatUsd(point.value)}
                        </p>
                      )}
                    </div>
                  )
                }
                return null
              }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#F7931A"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorBtc)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
