"use client"

import { useMemo } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { useApp } from "@/lib/app-context"
import { buildCumulativeCashFlowSeries } from "@/lib/cash-flow-series"
import { formatUsd } from "@/lib/data"
import { todayUtcIso } from "@/lib/transaction-visibility"

const CASH_FLOW_START = "2000-01-01"

export function TransactionsCashFlowPanel() {
  const { activeTransactions } = useApp()

  const series = useMemo(
    () =>
      buildCumulativeCashFlowSeries({
        transactions: activeTransactions,
        startDate: CASH_FLOW_START,
        todayIso: todayUtcIso(),
      }),
    [activeTransactions],
  )

  const chartData = useMemo(
    () => series.map((p) => ({ ...p, label: p.date })),
    [series],
  )

  if (chartData.length === 0) {
    return (
      <div className="flex min-h-[220px] min-w-0 flex-1 flex-col justify-center rounded-2xl border border-[#1F1F1F] bg-[#0D0D0D] p-4 md:p-6">
        <h3 className="text-lg font-semibold text-foreground">Cash flow</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Money in and out from your accounts builds a running total here once you have activity.
        </p>
        <p className="mt-6 text-center text-sm text-muted-foreground">Not enough data yet.</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-[240px] min-w-0 flex-1 flex-col gap-3 rounded-2xl border border-[#1F1F1F] bg-[#0D0D0D] p-4 md:p-6 lg:max-h-none">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Cash flow</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Running total of money that came in versus what you spent (through today).
        </p>
      </div>
      <div className="h-[220px] min-h-[220px] w-full min-w-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="txnCashFlowFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: "#888", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "#333" }}
              minTickGap={28}
            />
            <YAxis
              width={52}
              tick={{ fill: "#888", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "#333" }}
              tickFormatter={(v) => formatUsd(Number(v), 0)}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1A1A1A",
                border: "1px solid #333",
                borderRadius: "8px",
              }}
              labelStyle={{ color: "#A3A3A3" }}
              formatter={(value: number) => [formatUsd(value), "Net so far"]}
            />
            <Area
              type="monotone"
              dataKey="spent"
              name="Net cash flow"
              stroke="#3B82F6"
              strokeWidth={2}
              fill="url(#txnCashFlowFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
