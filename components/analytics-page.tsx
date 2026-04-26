"use client"

import { useState, useMemo, useDeferredValue, useCallback } from "react"
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
  Sankey,
} from "recharts"
import { useApp } from "@/lib/app-context"
import { useBtcPrices } from "@/lib/btc-price-context"
import { formatUsd, getMonthKey, type Envelope, type Transaction } from "@/lib/data"

type RangeKey = "mtd" | "1m" | "3m" | "12m" | "ytd" | "all" | "custom"
type HeatmapMode = "count" | "spent"

interface HeatmapDay {
  date: string
  count: number
  spent: number
  inRange: boolean
}

interface SankeyNode {
  name: string
  color: string
}

interface SankeyLink {
  source: number
  target: number
  value: number
}

interface SankeyNodeProps {
  x: number
  y: number
  width: number
  height: number
  payload?: SankeyNode
}

interface HeatmapLayout {
  gapClass: string
  squareClass: string
  labelClass: string
}

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "mtd", label: "MTD" },
  { key: "1m", label: "1M" },
  { key: "3m", label: "3M" },
  { key: "12m", label: "12M" },
  { key: "ytd", label: "YTD" },
  { key: "all", label: "All" },
]

const HEATMAP_INTENSITY_CLASSES = [
  "bg-[#1A1A1A]",
  "bg-[#3A2410]",
  "bg-[#6B3A0D]",
  "bg-[#A85F12]",
  "bg-[#F7931A]",
]

const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""]

function toIsoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
}

function todayIso(): string {
  return new Date().toISOString().split("T")[0]
}

function parseIsoDate(date: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const parsed = new Date(`${date}T12:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function getStartDateForRange(key: RangeKey, earliestTransactionDate?: string): string {
  const d = new Date()
  switch (key) {
    case "mtd":
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`
    case "1m":
      d.setUTCMonth(d.getUTCMonth() - 1)
      break
    case "3m":
      d.setUTCMonth(d.getUTCMonth() - 3)
      break
    case "12m":
      d.setUTCFullYear(d.getUTCFullYear() - 1)
      break
    case "ytd":
      return `${d.getUTCFullYear()}-01-01`
    case "all":
      return earliestTransactionDate || todayIso()
    case "custom":
      return todayIso()
  }
  return toIsoDate(d)
}

function getDaysBetween(startDate: string, endDate: string): string[] {
  const start = parseIsoDate(startDate)
  const end = parseIsoDate(endDate)
  if (!start || !end || start > end) return []

  const days: string[] = []
  let current = start
  while (current <= end) {
    days.push(toIsoDate(current))
    current = addDays(current, 1)
  }
  return days
}

function formatHeatmapDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function getHeatmapIntensityClass(value: number, max: number): string {
  if (value <= 0 || max <= 0) return HEATMAP_INTENSITY_CLASSES[0]
  const bucket = Math.max(1, Math.ceil((value / max) * 4))
  return HEATMAP_INTENSITY_CLASSES[bucket]
}

function getHeatmapLayout(dayCount: number): HeatmapLayout {
  if (dayCount <= 14) {
    return { gapClass: "gap-1.5", squareClass: "h-5 w-5", labelClass: "h-5 leading-5" }
  }
  if (dayCount <= 42) {
    return { gapClass: "gap-1.5", squareClass: "h-4 w-4", labelClass: "h-4 leading-4" }
  }
  return { gapClass: "gap-1", squareClass: "h-3 w-3", labelClass: "h-3 leading-3" }
}

function buildHeatmapDays(transactions: Transaction[], startDate: string, endDate: string): HeatmapDay[] {
  if (transactions.length === 0) return []

  const rangeDays = getDaysBetween(startDate, endDate)
  if (rangeDays.length === 0) return []

  const firstDate = parseIsoDate(rangeDays[0])
  const lastDate = parseIsoDate(rangeDays[rangeDays.length - 1])
  if (!firstDate || !lastDate) return []

  const paddedStart = addDays(firstDate, -firstDate.getUTCDay())
  const paddedEnd = addDays(lastDate, 6 - lastDate.getUTCDay())
  const byDay = new Map<string, { count: number; spent: number }>()

  for (const txn of transactions) {
    const entry = byDay.get(txn.date) ?? { count: 0, spent: 0 }
    entry.count += 1
    if (txn.type === "expense") {
      entry.spent += txn.amount
    }
    byDay.set(txn.date, entry)
  }

  const days: HeatmapDay[] = []
  let current = paddedStart
  while (current <= paddedEnd) {
    const date = toIsoDate(current)
    const entry = byDay.get(date) ?? { count: 0, spent: 0 }
    days.push({
      date,
      count: entry.count,
      spent: entry.spent,
      inRange: date >= startDate && date <= endDate,
    })
    current = addDays(current, 1)
  }
  return days
}

function buildIncomeFlowData(transactions: Transaction[], activeEnvelopes: Envelope[]) {
  const envelopeSpend = new Map<string, number>()
  let totalIncome = 0
  let totalExpenses = 0

  for (const txn of transactions) {
    if (txn.type === "credit") {
      totalIncome += txn.amount
    } else {
      totalExpenses += txn.amount
      envelopeSpend.set(txn.envelopeId, (envelopeSpend.get(txn.envelopeId) ?? 0) + txn.amount)
    }
  }

  const spendNodes = activeEnvelopes
    .map((env) => ({
      id: env.id,
      name: env.name,
      color: env.color,
      value: envelopeSpend.get(env.id) ?? 0,
    }))
    .filter((env) => env.value > 0)
    .sort((a, b) => b.value - a.value)

  const nodes: SankeyNode[] = [{ name: "Income", color: "#22C55E" }]
  const links: SankeyLink[] = []

  for (const env of spendNodes) {
    nodes.push({ name: env.name, color: env.color })
    links.push({ source: 0, target: nodes.length - 1, value: env.value })
  }

  const unspent = Math.max(totalIncome - totalExpenses, 0)
  if (unspent > 0) {
    nodes.push({ name: "Unspent", color: "#3B82F6" })
    links.push({ source: 0, target: nodes.length - 1, value: unspent })
  }

  return {
    data: { nodes, links },
    totalIncome,
    totalExpenses,
    unspent,
    overspent: Math.max(totalExpenses - totalIncome, 0),
  }
}

function IncomeFlowNode({ x, y, width, height, payload }: SankeyNodeProps) {
  const color = payload?.color ?? "#F7931A"
  const label = payload?.name ?? ""

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={4} fill={color} fillOpacity={0.9} />
      <text x={x + width + 8} y={y + height / 2} dy="0.35em" fill="#A3A3A3" fontSize={11}>
        {label}
      </text>
    </g>
  )
}

export function AnalyticsPage() {
  const { state, activeEnvelopes, activeTransactions, historyReady } = useApp()
  const { calculateOpportunityCost } = useBtcPrices()
  const [activeRange, setActiveRange] = useState<RangeKey>("12m")
  const [startDate, setStartDate] = useState(() => getStartDateForRange("12m"))
  const [endDate, setEndDate] = useState(() => todayIso())
  const [heatmapMode, setHeatmapMode] = useState<HeatmapMode>("count")

  const deferredTransactions = useDeferredValue(activeTransactions)

  const earliestTransactionDate = useMemo(
    () =>
      deferredTransactions.length > 0
        ? deferredTransactions.reduce((earliest, txn) => (txn.date < earliest ? txn.date : earliest), deferredTransactions[0].date)
        : undefined,
    [deferredTransactions],
  )

  const selectRange = useCallback((key: RangeKey) => {
    setActiveRange(key)
    setStartDate(getStartDateForRange(key, earliestTransactionDate))
    setEndDate(todayIso())
  }, [earliestTransactionDate])

  const startDateParsed = parseIsoDate(startDate)
  const endDateParsed = parseIsoDate(endDate)
  const invalidRange = !startDateParsed || !endDateParsed || startDateParsed > endDateParsed

  const filtered = useMemo(
    () =>
      invalidRange
        ? []
        : deferredTransactions.filter((t) => t.date >= startDate && t.date <= endDate),
    [deferredTransactions, invalidRange, startDate, endDate],
  )

  const rangeExceeds30Days = useMemo(() => {
    if (invalidRange || !startDateParsed || !endDateParsed) return false
    return Math.abs(endDateParsed.getTime() - startDateParsed.getTime()) > 30 * 86400000
  }, [invalidRange, startDateParsed, endDateParsed])

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
    if (!state.opportunityCostEnabled) return []
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
  }, [state.opportunityCostEnabled, filtered, activeEnvelopes, calculateOpportunityCost])

  const heatmapDays = useMemo(
    () => buildHeatmapDays(filtered, startDate, endDate),
    [filtered, startDate, endDate],
  )

  const heatmapMax = useMemo(
    () => Math.max(0, ...heatmapDays.map((day) => (heatmapMode === "count" ? day.count : day.spent))),
    [heatmapDays, heatmapMode],
  )

  const heatmapLayout = useMemo(
    () => getHeatmapLayout(heatmapDays.length),
    [heatmapDays.length],
  )

  const incomeFlow = useMemo(
    () => buildIncomeFlowData(filtered, activeEnvelopes),
    [filtered, activeEnvelopes],
  )

  return (
    <div className="flex flex-col gap-6">
      {!historyReady && rangeExceeds30Days && (
        <p className="text-xs text-amber-400/90 px-1" role="status">
          Historical data is still loading - charts will update as more transactions arrive.
        </p>
      )}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 md:p-5 bg-[#0D0D0D] rounded-2xl">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Analytics</h2>
          {invalidRange && (
            <p className="text-xs text-amber-400/90 mt-1" role="status">
              Choose a valid start and end date to update the charts.
            </p>
          )}
        </div>
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 w-full sm:w-auto">
          <div className="flex items-center gap-1 bg-[#1A1A1A] rounded-lg p-1 w-full sm:w-fit overflow-x-auto no-scrollbar">
            {RANGE_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => selectRange(key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  activeRange === key
                    ? "bg-btc-orange text-[#0D0D0D]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-col xs:flex-row xs:items-center gap-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setActiveRange("custom")
                setStartDate(e.target.value)
              }}
              className="bg-[#1A1A1A] border border-[#333] rounded-lg px-3 py-1.5 text-sm text-foreground"
            />
            <span className="text-muted-foreground text-sm hidden xs:inline">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setActiveRange("custom")
                setEndDate(e.target.value)
              }}
              className="bg-[#1A1A1A] border border-[#333] rounded-lg px-3 py-1.5 text-sm text-foreground"
            />
          </div>
        </div>
      </div>

      <div className="p-4 md:p-6 bg-[#0D0D0D] rounded-2xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Daily Activity</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Each square represents one day in the selected range.
            </p>
          </div>
          <div className="flex items-center gap-1 bg-[#1A1A1A] rounded-lg p-1 w-fit">
            <button
              type="button"
              onClick={() => setHeatmapMode("count")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                heatmapMode === "count"
                  ? "bg-btc-orange text-[#0D0D0D]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Transactions
            </button>
            <button
              type="button"
              onClick={() => setHeatmapMode("spent")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                heatmapMode === "spent"
                  ? "bg-btc-orange text-[#0D0D0D]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              $ Volume
            </button>
          </div>
        </div>
        {invalidRange ? (
          <div className="flex items-center justify-center h-[160px] text-muted-foreground text-sm">
            Choose a valid date range to see daily activity.
          </div>
        ) : heatmapDays.length > 0 ? (
          <>
            <div className="overflow-x-auto pb-2">
              <div className="grid grid-cols-[auto_auto] gap-2 w-fit min-w-max">
                <div className={`grid grid-rows-7 ${heatmapLayout.gapClass} text-[10px] text-muted-foreground`}>
                  {WEEKDAY_LABELS.map((label, index) => (
                    <span key={`${label}-${index}`} className={heatmapLayout.labelClass}>
                      {label}
                    </span>
                  ))}
                </div>
                <div className={`grid grid-flow-col grid-rows-7 ${heatmapLayout.gapClass}`}>
                  {heatmapDays.map((day) => {
                    const value = heatmapMode === "count" ? day.count : day.spent
                    const title = `${formatHeatmapDate(day.date)}: ${day.count} transaction${day.count === 1 ? "" : "s"}, ${formatUsd(day.spent)} spent`
                    return (
                      <div
                        key={day.date}
                        title={title}
                        aria-label={title}
                        className={`${heatmapLayout.squareClass} rounded-[3px] border border-[#252525] ${getHeatmapIntensityClass(value, heatmapMax)} ${
                          day.inRange ? "opacity-100" : "opacity-25"
                        }`}
                      />
                    )
                  })}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-4 text-[10px] text-muted-foreground">
              <span>Less</span>
              {HEATMAP_INTENSITY_CLASSES.map((className) => (
                <span key={className} className={`h-3 w-3 rounded-[3px] border border-[#252525] ${className}`} aria-hidden="true" />
              ))}
              <span>More</span>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-[160px] text-muted-foreground text-sm">
            No transaction data for this period.
          </div>
        )}
      </div>

      <div className="p-4 md:p-6 bg-[#0D0D0D] rounded-2xl">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-5">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Income Flow</h3>
            <p className="text-xs text-muted-foreground mt-1">
              See how income in this range maps to envelope spending.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="text-muted-foreground">
              Income: <span className="text-foreground font-medium">{formatUsd(incomeFlow.totalIncome)}</span>
            </span>
            <span className="text-muted-foreground">
              Spent: <span className="text-foreground font-medium">{formatUsd(incomeFlow.totalExpenses)}</span>
            </span>
            {incomeFlow.unspent > 0 && (
              <span className="text-muted-foreground">
                Unspent: <span className="text-[#3B82F6] font-medium">{formatUsd(incomeFlow.unspent)}</span>
              </span>
            )}
            {incomeFlow.overspent > 0 && (
              <span className="text-muted-foreground">
                Over income: <span className="text-amber-400 font-medium">{formatUsd(incomeFlow.overspent)}</span>
              </span>
            )}
          </div>
        </div>
        {invalidRange ? (
          <div className="flex items-center justify-center h-[260px] text-muted-foreground text-sm">
            Choose a valid date range to see income flow.
          </div>
        ) : incomeFlow.data.links.length > 0 ? (
          <div className="h-[260px] md:h-[340px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <Sankey
                data={incomeFlow.data}
                node={<IncomeFlowNode x={0} y={0} width={0} height={0} />}
                nodePadding={18}
                margin={{ top: 12, right: 120, bottom: 12, left: 12 }}
                link={{ stroke: "#F7931A", strokeOpacity: 0.28 }}
              >
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const point = payload[0]
                    return (
                      <div className="bg-[#1A1A1A] border border-[#333] p-3 rounded-lg shadow-xl">
                        <p className="text-sm font-medium text-foreground">{point.name}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Flow: <span className="text-foreground">{formatUsd(point.value as number)}</span>
                        </p>
                      </div>
                    )
                  }}
                />
              </Sankey>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex items-center justify-center h-[260px] text-muted-foreground text-sm text-center">
            Add income or expense transactions in this range to see a flow graph.
          </div>
        )}
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
            <div className="w-3 h-3 rounded-sm bg-success" />
            <span className="text-xs text-muted-foreground">Income</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-btc-orange" />
            <span className="text-xs text-muted-foreground">Expenses</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-4 md:p-6 bg-[#0D0D0D] rounded-2xl">
          <h3 className="text-lg font-semibold text-foreground mb-5">By Envelope</h3>
          <div className="h-[280px] md:h-[300px] w-full">
            {envelopePieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
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

        {state.opportunityCostEnabled && (
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
                <div className="w-3 h-3 rounded-sm bg-btc-orange" />
                <span className="text-xs text-muted-foreground">Opportunity Cost</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
