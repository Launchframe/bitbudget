"use client"

import { useState, useMemo } from "react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts"
import { useApp } from "@/lib/app-context"
import { useBtcPrices } from "@/lib/btc-price-context"
import { formatUsd, getMonthKey } from "@/lib/data"

export function AnalyticsPage() {
  const { state, activeEnvelopes, activeTransactions } = useApp()
  const { calculateOpportunityCost } = useBtcPrices()
  const [startDate, setStartDate] = useState("2025-09-01")
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0])

  const filtered = useMemo(
    () => activeTransactions.filter((t) => t.date >= startDate && t.date <= endDate),
    [activeTransactions, startDate, endDate],
  )

  const cashFlowData = useMemo(() => {
    const months: Record<string, { income: number; expenses: number }> = {}
    for (const txn of filtered) {
      const mk = getMonthKey(txn.date)
      if (!months[mk]) months[mk] = { income: 0, expenses: 0 }
      if (txn.type === "credit") months[mk].income += txn.amount
      else months[mk].expenses += txn.amount
    }
    return Object.entries(months)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month: new Date(month + "-01").toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        Income: data.income,
        Expenses: data.expenses,
      }))
  }, [filtered])

  const envelopePieData = useMemo(() => {
    const envelopeMap: Record<string, number> = {}
    for (const txn of filtered) {
      if (txn.type === "expense") {
        envelopeMap[txn.envelopeId] = (envelopeMap[txn.envelopeId] || 0) + txn.amount
      }
    }
    return activeEnvelopes
      .map((env) => ({
        name: env.name,
        value: envelopeMap[env.id] || 0,
        color: env.color,
      }))
      .filter((d) => d.value > 0)
  }, [filtered, activeEnvelopes])

  const opportunityCostData = useMemo(() => {
    const byEnvelope: Record<string, { spent: number; opCost: number }> = {}
    for (const txn of filtered) {
      if (txn.type === "expense") {
        if (!byEnvelope[txn.envelopeId]) byEnvelope[txn.envelopeId] = { spent: 0, opCost: 0 }
        byEnvelope[txn.envelopeId].spent += txn.amount
        byEnvelope[txn.envelopeId].opCost += calculateOpportunityCost(txn.amount, txn.date)
      }
    }
    return activeEnvelopes
      .filter((env) => byEnvelope[env.id])
      .map((env) => ({
        name: env.name,
        "Dollar Spend": Math.round(byEnvelope[env.id].spent),
        "Opportunity Cost": Math.round(byEnvelope[env.id].opCost),
        color: env.color,
      }))
  }, [filtered, activeEnvelopes, calculateOpportunityCost])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 md:p-5 bg-[#0D0D0D] rounded-2xl">
        <h2 className="text-xl font-semibold text-foreground">Analytics</h2>
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
      </div>

      <div className="p-4 md:p-6 bg-[#0D0D0D] rounded-2xl">
        <h3 className="text-lg font-semibold text-foreground mb-5">Cash Flow</h3>
        <div className="h-[220px] md:h-[300px] w-full">
          {cashFlowData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cashFlowData} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1F1F1F" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: "#666", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fill: "#666", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                  width={50}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-[#1A1A1A] border border-[#333] p-3 rounded-lg shadow-xl">
                          <p className="text-xs text-muted-foreground mb-2">{label}</p>
                          {payload.map((p) => (
                            <p key={p.name} className="text-sm text-foreground">
                              <span style={{ color: p.color }} className="font-medium">{p.name}: </span>
                              {formatUsd(p.value as number)}
                            </p>
                          ))}
                        </div>
                      )
                    }
                    return null
                  }}
                />
                <Bar dataKey="Income" fill="#22C55E" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Expenses" fill="#F7931A" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              No transaction data for this period.
            </div>
          )}
        </div>
        <div className="flex items-center gap-6 mt-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-[#22C55E]" />
            <span className="text-xs text-muted-foreground">Income</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-[#F7931A]" />
            <span className="text-xs text-muted-foreground">Expenses</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-4 md:p-6 bg-[#0D0D0D] rounded-2xl">
          <h3 className="text-lg font-semibold text-foreground mb-5">By Envelope</h3>
          <div className="h-[220px] md:h-[300px] w-full">
            {envelopePieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={envelopePieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={3}
                    dataKey="value"
                    nameKey="name"
                    stroke="none"
                  >
                    {envelopePieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="bg-[#1A1A1A] border border-[#333] p-3 rounded-lg shadow-xl">
                            <p className="text-sm font-medium text-foreground">
                              {payload[0].name}: {formatUsd(payload[0].value as number)}
                            </p>
                          </div>
                        )
                      }
                      return null
                    }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    formatter={(value: string) => <span className="text-xs text-muted-foreground">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                No expense data for this period.
              </div>
            )}
          </div>
        </div>

        <div className="p-4 md:p-6 bg-[#0D0D0D] rounded-2xl">
          <h3 className="text-lg font-semibold text-foreground mb-5">Opportunity Cost</h3>
          <div className="h-[220px] md:h-[300px] w-full">
            {opportunityCostData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={opportunityCostData} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1F1F1F" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "#666", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fill: "#666", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`}
                    width={50}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="bg-[#1A1A1A] border border-[#333] p-3 rounded-lg shadow-xl">
                            <p className="text-xs text-muted-foreground mb-2">{label}</p>
                            {payload.map((p) => (
                              <p key={p.name} className="text-sm text-foreground">
                                <span style={{ color: p.color }} className="font-medium">{p.name}: </span>
                                {formatUsd(p.value as number)}
                              </p>
                            ))}
                          </div>
                        )
                      }
                      return null
                    }}
                  />
                  <Bar dataKey="Dollar Spend" fill="#666" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Opportunity Cost" fill="#F7931A" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                No expense data for this period.
              </div>
            )}
          </div>
          <div className="flex items-center gap-6 mt-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-[#666]" />
              <span className="text-xs text-muted-foreground">Dollar Spend</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-[#F7931A]" />
              <span className="text-xs text-muted-foreground">Opportunity Cost</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
