"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { useApp } from "@/lib/app-context"
import {
  buildMonthOverlayChartData,
  computeSavingsConsistencyScore,
  discretionaryEnvelopeIdsFromEnvelopes,
  monthKeysInLookback,
  type MonthOverlayMode,
} from "@/lib/analytics-month-overlay"
import { findSavingsEnvelope } from "@/lib/savings-ui-metrics"
import { formatUsd } from "@/lib/data"
import { SAVINGS_GOLD_ACCENT } from "@/lib/constants"
import type { SavingsGoalRow } from "@/lib/savings-ui-metrics"
import type { PaydayUserFields } from "@/lib/payday-cadence"

type MonthCount = 3 | 6 | 12

const MONTH_COUNT_OPTIONS: { key: MonthCount; label: string }[] = [
  { key: 3, label: "3M" },
  { key: 6, label: "6M" },
  { key: 12, label: "12M" },
]

const LINE_COLORS = [
  "#666666",
  "#737373",
  "#808080",
  "#8C8C8C",
  "#999999",
  "#A6A6A6",
  "#B3B3B3",
  "#BFBFBF",
  "#CCCCCC",
  "#D9D9D9",
  "#E6E6E6",
  "#F7931A",
]

interface UserPaydaySettings extends PaydayUserFields {
  monthlyIncome: number
}

function parsePaydaySettings(raw: unknown): UserPaydaySettings | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  return {
    payCadence: typeof o.payCadence === "string" ? o.payCadence : "monthly",
    payDays: Array.isArray(o.payDays)
      ? o.payDays.filter((d): d is number => typeof d === "number")
      : [],
    payDayOfWeek: typeof o.payDayOfWeek === "number" ? o.payDayOfWeek : null,
    lastPaydayAt:
      typeof o.lastPaydayAt === "string" ? new Date(o.lastPaydayAt) : null,
    monthlyIncome: typeof o.monthlyIncome === "number" ? o.monthlyIncome : 0,
  }
}

export function MonthOverlayChart() {
  const { activeTransactions, state, discretionaryEnvelopes } = useApp()
  const [mode, setMode] = useState<MonthOverlayMode>("cash_flow")
  const [monthCount, setMonthCount] = useState<MonthCount>(12)
  const [paydaySettings, setPaydaySettings] = useState<UserPaydaySettings | null>(null)
  const [closedGoals, setClosedGoals] = useState<SavingsGoalRow[]>([])

  const savingsEnvelope = useMemo(
    () => findSavingsEnvelope(state.envelopes),
    [state.envelopes],
  )

  const discretionaryIds = useMemo(
    () => discretionaryEnvelopeIdsFromEnvelopes(discretionaryEnvelopes),
    [discretionaryEnvelopes],
  )

  const loadMeta = useCallback(async () => {
    const now = new Date()
    const monthKeys = monthKeysInLookback(monthCount, now)
    const from = monthKeys[0]
    const to = monthKeys[monthKeys.length - 1]
    if (!from || !to) return

    const [settingsRes, goalsRes] = await Promise.all([
      fetch("/api/user/settings"),
      fetch(`/api/user/savings-goals?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    ])

    if (settingsRes.ok) {
      const settings = await settingsRes.json()
      setPaydaySettings(parsePaydaySettings(settings))
    }

    if (goalsRes.ok) {
      const data = (await goalsRes.json()) as { goals?: SavingsGoalRow[] }
      const closed = (data.goals ?? []).filter(g => g.closedAt != null)
      setClosedGoals(closed)
    }
  }, [monthCount])

  useEffect(() => {
    const id = window.setTimeout(() => {
      void loadMeta()
    }, 0)
    return () => window.clearTimeout(id)
  }, [loadMeta])

  const paydayUser: PaydayUserFields = useMemo(
    () =>
      paydaySettings ?? {
        payCadence: "monthly",
        payDays: [],
        payDayOfWeek: null,
        lastPaydayAt: null,
      },
    [paydaySettings],
  )

  const monthlyBudget = paydaySettings?.monthlyIncome ?? state.monthlyIncome

  const chartData = useMemo(
    () =>
      buildMonthOverlayChartData({
        mode,
        transactions: activeTransactions,
        monthCount,
        paydayUser,
        monthlyBudget,
        savingsEnvelopeId: savingsEnvelope?.id ?? null,
        discretionaryEnvelopeIds: discretionaryIds,
        closedGoals,
      }),
    [
      mode,
      activeTransactions,
      monthCount,
      paydayUser,
      monthlyBudget,
      savingsEnvelope?.id,
      discretionaryIds,
      closedGoals,
    ],
  )

  const consistencyScore = useMemo(
    () => computeSavingsConsistencyScore(closedGoals),
    [closedGoals],
  )

  const hasData = chartData.series.some(s => s.points.some(p => p.value != null))

  return (
    <div className="p-4 md:p-6 bg-[#0D0D0D] rounded-2xl">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-5">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-foreground">Month Overlay</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Overlap recent months by day-of-month to spot spending and savings rhythms.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-1 bg-[#1A1A1A] rounded-lg p-1 w-fit">
            <button
              type="button"
              aria-pressed={mode === "cash_flow"}
              onClick={() => setMode("cash_flow")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                mode === "cash_flow"
                  ? "bg-btc-orange text-[#0D0D0D]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Cash Flow
            </button>
            <button
              type="button"
              aria-pressed={mode === "savings"}
              onClick={() => setMode("savings")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                mode === "savings"
                  ? "bg-btc-orange text-[#0D0D0D]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Savings
            </button>
          </div>
          <div className="flex items-center gap-1 bg-[#1A1A1A] rounded-lg p-1 w-fit">
            {MONTH_COUNT_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                aria-pressed={monthCount === key}
                onClick={() => setMonthCount(key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  monthCount === key
                    ? "bg-btc-orange text-[#0D0D0D]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 mb-4">
        <div className="h-[260px] md:h-[320px] w-full">
          {hasData ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData.chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1F1F1F" vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fill: "#666", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  label={{ value: "Day of month", position: "insideBottom", offset: -2, fill: "#666", fontSize: 10 }}
                />
                <YAxis
                  tick={{ fill: "#666", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                  }
                  width={52}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    return (
                      <div className="bg-[#1A1A1A] border border-[#333] p-3 rounded-lg shadow-xl max-w-xs">
                        <p className="text-xs text-muted-foreground mb-2">Day {label}</p>
                        {payload
                          .filter(p => p.value != null)
                          .map(p => (
                            <p key={p.dataKey} className="text-sm text-foreground">
                              <span style={{ color: p.color }} className="font-medium">
                                {chartData.series.find(s => s.monthKey === p.dataKey)?.label ?? p.dataKey}:{" "}
                              </span>
                              {formatUsd(p.value as number)}
                            </p>
                          ))}
                      </div>
                    )
                  }}
                />
                {chartData.series.map((s, idx) => {
                  const color = LINE_COLORS[Math.min(idx, LINE_COLORS.length - 1)] ?? "#666"
                  const isAnnotatedBest = s.monthKey === chartData.bestMonthKey
                  const isAnnotatedWorst = s.monthKey === chartData.worstMonthKey
                  const name =
                    isAnnotatedBest && isAnnotatedWorst
                      ? `${s.label} (best & worst)`
                      : isAnnotatedBest
                        ? `${s.label} (best)`
                        : isAnnotatedWorst
                          ? `${s.label} (worst)`
                          : s.label

                  return (
                    <Line
                      key={s.monthKey}
                      type="monotone"
                      dataKey={s.monthKey}
                      name={name}
                      stroke={mode === "savings" && s.isLatest ? SAVINGS_GOLD_ACCENT : color}
                      strokeWidth={s.isLatest ? 2.5 : 1.25}
                      strokeOpacity={s.isLatest ? 1 : 0.55}
                      dot={false}
                      connectNulls={false}
                    />
                  )
                })}
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  formatter={(value: string) => (
                    <span className="text-xs text-muted-foreground">{value}</span>
                  )}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm text-center px-4">
              Add transactions across a few months to see month-over-month patterns.
            </div>
          )}
        </div>

        <div className="flex lg:flex-col gap-3 lg:min-w-[140px]">
          <div className="flex-1 lg:flex-none rounded-xl border border-[#252525] bg-[#1A1A1A] px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Savings consistency
            </p>
            <p className="text-2xl font-semibold text-foreground mt-1">
              {consistencyScore != null ? `${consistencyScore}%` : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Months hitting your savings goal
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
