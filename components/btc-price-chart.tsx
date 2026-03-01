"use client"

import { useState, useMemo } from "react"
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts"
import { useBtcPrices } from "@/lib/btc-price-context"
import { formatUsd, formatNumber } from "@/lib/data"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

export function BtcPriceChart() {
  const [showSats, setShowSats] = useState(false)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - 1)
    return d.toISOString().split("T")[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0])

  const { priceHistory } = useBtcPrices()

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

  return (
    <div className="flex flex-col gap-5 p-6 bg-[#0D0D0D] rounded-2xl">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold text-foreground">BTC Price</h2>
          <span className="text-sm text-muted-foreground px-2 py-0.5 bg-[#1A1A1A] rounded-full">
            {showSats ? "Sats/$" : "BTC/USD"}
          </span>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-[#1A1A1A] border border-[#333] rounded-lg px-3 py-1.5 text-sm text-foreground"
            />
            <span className="text-muted-foreground text-sm">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-[#1A1A1A] border border-[#333] rounded-lg px-3 py-1.5 text-sm text-foreground"
            />
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
