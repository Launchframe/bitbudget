"use client"

import { useMemo, useState, useCallback, useSyncExternalStore, useEffect, useRef } from "react"
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend, ReferenceLine, ReferenceArea } from "recharts"
import { useApp } from "@/lib/app-context"
import { useBtcPrices } from "@/lib/btc-price-context"
import { formatUsd } from "@/lib/data"
import { findSavingsEnvelope, isSavingsInflowCredit } from "@/lib/savings-ui-metrics"
import {
  buildCumulativeCashFlowSeries,
  buildCumulativeSavingsInflowSeries,
  isCashInflowCredit,
  isCashOutflowExpense,
} from "@/lib/cash-flow-series"
import { buildCumulativeSpendingSeries } from "@/lib/cumulative-spending-series"
import { isAnalyticsExpense } from "@/lib/transaction-visibility"
import {
  DASHBOARD_CHART_RANGE_OVERRIDE_KEY,
  getDashboardChartMode,
  setDashboardChartMode,
  subscribeDashboardChartMode,
  type DashboardChartMode,
} from "@/lib/dashboard-chart-mode"
import {
  getDashboardChartRange,
  setDashboardChartCustomRange,
  setDashboardChartPresetRange,
  subscribeDashboardChartRange,
  type DashboardChartRangeKey,
} from "@/lib/dashboard-chart-range"
import { parseIsoDateLocal } from "@/lib/chart-x-axis-format"
import { SAVINGS_GOLD_ACCENT, SAVINGS_EXPERIENCE_DISMISSED } from "@/lib/constants"
// Shared tick rules (incl. short spans / 5Y imported history) live in `lib/chart-x-axis-format.ts`.
import { formatExpenseChartXAxisTick } from "@/lib/chart-x-axis-format"
import { BarChart3 } from "lucide-react"
import { PriceGainLossBadge } from "@/components/price-gain-loss-badge"

type PresetRangeKey = Exclude<DashboardChartRangeKey, "custom">
type ChartMode = DashboardChartMode

const RANGE_OPTIONS: { key: PresetRangeKey; label: string }[] = [
  { key: "mtd", label: "MTD" },
  { key: "1m", label: "1M" },
  { key: "3m", label: "3M" },
  { key: "12m", label: "12M" },
  { key: "ytd", label: "YTD" },
  { key: "5y", label: "5Y" },
  { key: "all", label: "All" },
]

function formatCustomRangeLabel(startDate: string, endDate: string): string {
  const start = parseIsoDateLocal(startDate)
  const end = parseIsoDateLocal(endDate)
  const sameYear = start.getFullYear() === end.getFullYear()
  const startFmt = start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  })
  const endFmt = end.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  return `${startFmt} – ${endFmt}`
}

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
  const { activeTransactions, state, accountCreatedAtIso } = useApp()
  const { getPriceOnDate, currentPrice, priceHistory } = useBtcPrices()
  const chartRange = useSyncExternalStore(
    subscribeDashboardChartRange,
    getDashboardChartRange,
    () => getDashboardChartRange(),
  )
  const { activeRange, startDate, endDate } = chartRange
  const chartMode = useSyncExternalStore(
    subscribeDashboardChartMode,
    getDashboardChartMode,
    () => "spending" as ChartMode,
  )
  const setChartMode = useCallback((mode: ChartMode) => {
    setDashboardChartMode(mode)
  }, [])
  const [dragStartDate, setDragStartDate] = useState<string | null>(null)
  const [dragEndDate, setDragEndDate] = useState<string | null>(null)
  const isDraggingRef = useRef(false)
  const isMobile = useIsMobile()
  const ocEnabled = state.opportunityCostEnabled

  const selectRange = useCallback((key: PresetRangeKey) => {
    setDashboardChartPresetRange(key)
  }, [])

  const filterSeriesToRange = useCallback(
    <T extends { date: string }>(series: T[]): T[] =>
      series.filter((p) => p.date >= startDate && p.date <= endDate),
    [startDate, endDate],
  )

  const savingsEnvelope = useMemo(
    () => findSavingsEnvelope(state.envelopes),
    [state.envelopes],
  )

  const savingsModeAvailable =
    state.savingsExperience !== SAVINGS_EXPERIENCE_DISMISSED && savingsEnvelope != null
  const effectiveChartMode: ChartMode =
    chartMode === "savings" && !savingsModeAvailable ? "spending" : chartMode

  useEffect(() => {
    if (!savingsModeAvailable && chartMode === "savings") {
      setDashboardChartMode("spending")
    }
  }, [savingsModeAvailable, chartMode])

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    try {
      const override = sessionStorage.getItem(DASHBOARD_CHART_RANGE_OVERRIDE_KEY)
      if (override === "all") {
        sessionStorage.removeItem(DASHBOARD_CHART_RANGE_OVERRIDE_KEY)
        timeoutId = setTimeout(() => selectRange("all"), 0)
      }
    } catch {
      /* ignore */
    }
    return () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
  }, [selectRange])

  const hasAnyExpenses = useMemo(
    () => activeTransactions.some(isAnalyticsExpense),
    [activeTransactions],
  )

  const hasAnyCashFlow = useMemo(
    () =>
      activeTransactions.some(
        (t) =>
          (isCashInflowCredit(t) || isCashOutflowExpense(t)) &&
          t.date.split("T")[0] >= startDate,
      ),
    [activeTransactions, startDate],
  )

  const savingsSeriesStart = accountCreatedAtIso ?? startDate

  const cashFlowData = useMemo(() => {
    const series = buildCumulativeCashFlowSeries({
      transactions: activeTransactions,
      startDate: "2009-01-03",
    })
    return filterSeriesToRange(series)
  }, [activeTransactions, filterSeriesToRange])

  const savingsChartData = useMemo(() => {
    if (!savingsEnvelope || !accountCreatedAtIso) return []
    const canOc = ocEnabled && currentPrice && priceHistory.length > 0
    const series = buildCumulativeSavingsInflowSeries({
      transactions: activeTransactions,
      savingsEnvelopeId: savingsEnvelope.id,
      startDate: savingsSeriesStart,
      isInflow: isSavingsInflowCredit,
      getPriceOnDate: canOc ? getPriceOnDate : undefined,
      priceHistory: canOc ? priceHistory : undefined,
    })
    return filterSeriesToRange(series)
  }, [
    activeTransactions,
    savingsEnvelope,
    accountCreatedAtIso,
    savingsSeriesStart,
    ocEnabled,
    currentPrice,
    priceHistory,
    getPriceOnDate,
    filterSeriesToRange,
  ])

  const hasAnySavingsInflows = useMemo(() => {
    if (!savingsEnvelope || !accountCreatedAtIso) return false
    return activeTransactions.some(
      (t) =>
        isSavingsInflowCredit(t, savingsEnvelope.id) &&
        t.date.split("T")[0] >= savingsSeriesStart &&
        t.date.split("T")[0] >= startDate,
    )
  }, [activeTransactions, savingsEnvelope, accountCreatedAtIso, savingsSeriesStart, startDate])

  // Full OC data (spent + btcValue) — only computed when OC is enabled
  const ocData = useMemo(() => {
    if (!ocEnabled) return []
    if (!currentPrice || activeTransactions.length === 0 || priceHistory.length === 0) return []

    return buildCumulativeSpendingSeries({
      transactions: activeTransactions,
      startDate,
      getPriceOnDate,
      priceHistory,
    })
  }, [ocEnabled, activeTransactions, currentPrice, priceHistory, getPriceOnDate, startDate])

  // Vanilla data — cumulative spent only, no BTC prices required
  const vanillaData = useMemo(() => {
    if (ocEnabled) return []
    return buildCumulativeSpendingSeries({
      transactions: activeTransactions,
      startDate,
    })
  }, [ocEnabled, activeTransactions, startDate])

  const filteredData = useMemo(() => {
    if (effectiveChartMode === "cashflow") return cashFlowData
    if (effectiveChartMode === "savings") return savingsChartData
    const spendingData = ocEnabled ? ocData : vanillaData
    return filterSeriesToRange(spendingData)
  }, [effectiveChartMode, cashFlowData, savingsChartData, ocEnabled, ocData, vanillaData, filterSeriesToRange])

  const beginDragSelection = useCallback((date: string) => {
    isDraggingRef.current = true
    setDragStartDate(date)
    setDragEndDate(date)
  }, [])

  const updateDragSelection = useCallback((date: string) => {
    if (!isDraggingRef.current) return
    setDragEndDate(date)
  }, [])

  const finishDragSelection = useCallback(() => {
    if (!isDraggingRef.current) {
      setDragStartDate(null)
      setDragEndDate(null)
      return
    }
    isDraggingRef.current = false
    const start = dragStartDate
    const end = dragEndDate ?? dragStartDate
    setDragStartDate(null)
    setDragEndDate(null)
    if (!start || !end || start === end) return
    setDashboardChartCustomRange(start, end)
  }, [dragStartDate, dragEndDate])

  const handleChartMouseDown = useCallback(
    (state: { activeLabel?: string | number }) => {
      if (!state?.activeLabel || typeof state.activeLabel !== "string") return
      beginDragSelection(state.activeLabel)
    },
    [beginDragSelection],
  )

  const handleChartMouseMove = useCallback(
    (state: { activeLabel?: string | number }) => {
      if (!state?.activeLabel || typeof state.activeLabel !== "string") return
      updateDragSelection(state.activeLabel)
    },
    [updateDragSelection],
  )

  const showBtcOverlay = ocEnabled && effectiveChartMode !== "cashflow"

  const yDomain = useMemo(() => {
    if (filteredData.length === 0) return [0, 100]
    const allVals = showBtcOverlay
      ? filteredData.flatMap((d) => [d.spent, d.btcValue])
      : filteredData.map((d) => d.spent)
    const min = Math.min(...allVals)
    const max = Math.max(...allVals)
    if (effectiveChartMode === "cashflow") {
      return [Math.floor(Math.min(0, min) * 1.1), Math.ceil(Math.max(0, max) * 1.1)]
    }
    return [0, Math.ceil(max * 1.1)]
  }, [filteredData, showBtcOverlay, effectiveChartMode])

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
    if (!showBtcOverlay) return { spent: last.spent, btcValue: 0, diff: 0 }
    const diff = last.btcValue - last.spent
    return { spent: last.spent, btcValue: last.btcValue, diff }
  }, [filteredData, showBtcOverlay])

  const title =
    effectiveChartMode === "cashflow"
      ? ocEnabled
        ? "Cumulative Cash Flow"
        : "Your cash flow"
      : effectiveChartMode === "savings"
        ? ocEnabled
          ? "Cumulative Savings"
          : "Your savings"
        : ocEnabled
          ? "Opportunity Cost"
          : "Your expenses"

  const emptyMessage =
    effectiveChartMode === "cashflow"
      ? activeTransactions.length === 0
        ? "Add transactions to see your cash flow."
        : !hasAnyCashFlow
          ? "No income or expense activity in this timeframe."
          : "No cash flow activity in this timeframe."
      : effectiveChartMode === "savings"
        ? activeTransactions.length === 0
          ? "Add transactions to see your savings trends."
          : !accountCreatedAtIso
            ? "Account start date is not available yet."
          : !hasAnySavingsInflows
            ? "No savings inflows since you joined."
            : "No savings inflows in this timeframe."
        : activeTransactions.length === 0
          ? "Add transactions to see your spending trends."
          : !hasAnyExpenses
            ? "No expense transactions to display."
            : "No expense transactions in this timeframe."

  const spentLabel =
    effectiveChartMode === "cashflow" ? "Net" : effectiveChartMode === "savings" ? "Saved" : "Spent"
  const btcLineName =
    effectiveChartMode === "savings" ? "Equivalent BTC Savings" : "Equivalent BTC Savings"
  const areaStroke =
    effectiveChartMode === "cashflow" || effectiveChartMode === "savings" ? SAVINGS_GOLD_ACCENT : "#888"
  const cumulativeAreaName =
    effectiveChartMode === "cashflow"
      ? "Cumulative Net Cash Flow (USD)"
      : effectiveChartMode === "savings"
        ? "Cumulative Saved (USD)"
        : "Cumulative Spent (USD)"

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 bg-[#0D0D0D] rounded-2xl">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-foreground">{title}</h2>

          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <div className="flex min-h-[3.25rem] flex-col justify-center gap-y-1 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
              {spread ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="text-muted-foreground">
                    {spentLabel}: <span className="text-foreground font-medium">{formatUsd(spread.spent)}</span>
                  </span>
                  {showBtcOverlay && (
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
              ) : (
                <span className="invisible select-none text-sm leading-snug" aria-hidden>
                  Saved: $0.00
                </span>
              )}
            </div>

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
                onClick={() => setChartMode("cashflow")}
                aria-pressed={effectiveChartMode === "cashflow"}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  effectiveChartMode === "cashflow"
                    ? "text-[#0D0D0D]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                style={
                  effectiveChartMode === "cashflow"
                    ? { backgroundColor: SAVINGS_GOLD_ACCENT }
                    : undefined
                }
              >
                Cash Flow
              </button>
              {savingsModeAvailable && (
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
              )}
            </div>

          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-[#1A1A1A] rounded-lg p-1 w-fit overflow-x-auto no-scrollbar">
            {RANGE_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
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
          {activeRange === "custom" && (
            <span className="text-xs text-muted-foreground">
              {formatCustomRangeLabel(startDate, endDate)}
            </span>
          )}
          <span className="text-xs text-muted-foreground hidden sm:inline">
            Drag across the chart to zoom in
          </span>
        </div>
      </div>

      {filteredData.length < 3 ? (
        <div className="h-[250px] md:h-[350px] flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <BarChart3 className="h-8 w-8 text-[#333]" />
          <p className="text-sm text-center max-w-xs">{emptyMessage}</p>
        </div>
      ) : (
        <div className="h-[250px] md:h-[350px] w-full select-none">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={filteredData}
              onMouseDown={handleChartMouseDown}
              onMouseMove={handleChartMouseMove}
              onMouseUp={finishDragSelection}
              onMouseLeave={finishDragSelection}
              style={{ cursor: "crosshair" }}
            >
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
              {effectiveChartMode === "cashflow" && (
                <ReferenceLine y={0} stroke={SAVINGS_GOLD_ACCENT} strokeDasharray="4 4" strokeOpacity={0.6} />
              )}
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
                        {showBtcOverlay && (
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
              {showBtcOverlay && !isMobile && (
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
                name={cumulativeAreaName}
                stroke={areaStroke}
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorSpent)"
                baseValue={effectiveChartMode === "cashflow" ? 0 : undefined}
              />
              {showBtcOverlay && (
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
              {dragStartDate && dragEndDate && dragStartDate !== dragEndDate && (
                <ReferenceArea
                  x1={dragStartDate}
                  x2={dragEndDate}
                  stroke="#F7931A"
                  strokeOpacity={0.8}
                  fill="#F7931A"
                  fillOpacity={0.15}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
