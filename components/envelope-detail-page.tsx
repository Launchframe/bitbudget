"use client"

import { useMemo } from "react"
import { useApp } from "@/lib/app-context"
import {
  envelopeGenesisFloor,
  formatUsd,
  getEnvelopeBalanceAllTime,
} from "@/lib/data"
import { envelopeBudgetProgressPct, envelopeHealthColor } from "@/lib/envelope-card-metrics"
import { SYSTEM_ENVELOPE_ROLE_SAVINGS } from "@/lib/constants"
import { monthProgressMarkerPct } from "@/lib/sweep-math"
import { Progress } from "@/components/ui/progress"
import { ArrowLeft } from "lucide-react"
import { TransactionsCashFlowPanel } from "@/components/transactions-cash-flow-panel"
import { TransactionsPage } from "@/components/transactions-page"

export function EnvelopeDetailPage() {
  const { state, selectedEnvelopeId, navigateTo } = useApp()

  const envelope = state.envelopes.find((e) => e.id === selectedEnvelopeId)

  const balance = useMemo(() => {
    if (!envelope) return 0
    return getEnvelopeBalanceAllTime(
      state.transactions,
      envelope.id,
      envelope.createdAt ? envelopeGenesisFloor(envelope.createdAt) : undefined,
    )
  }, [envelope, state.transactions])

  if (!envelope) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-muted-foreground">Envelope not found.</p>
        <button
          type="button"
          onClick={() => navigateTo("envelopes")}
          className="text-sm text-[#F7931A] hover:underline"
        >
          Back to Envelopes
        </button>
      </div>
    )
  }

  const isSavingsHub = envelope.systemRole === SYSTEM_ENVELOPE_ROLE_SAVINGS
  const progressPct = envelopeBudgetProgressPct(balance, envelope.monthlyAllotment)
  const monthMarkerPct = monthProgressMarkerPct()
  const healthColor = isSavingsHub
    ? balance > 0
      ? "#22C55E"
      : balance < 0
        ? "#EF4444"
        : "#A3A3A3"
    : envelopeHealthColor(progressPct)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-6">
        <div className="flex flex-col gap-4 rounded-2xl bg-[#0D0D0D] p-4 md:p-6 lg:w-[min(100%,24rem)] lg:max-w-md lg:shrink-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigateTo("envelopes")}
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-[#1A1A1A] hover:text-foreground"
              aria-label="Back to Envelopes"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-3">
              <div className="h-3 w-3 rounded-full" style={{ backgroundColor: envelope.color }} />
              <h2 className="text-xl font-semibold text-foreground">{envelope.name}</h2>
            </div>
          </div>

          <div className="mt-2 flex min-w-0 flex-col gap-4">
            <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
              <div className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Monthly Allotment</span>
                <span className="text-lg font-semibold text-foreground">{formatUsd(envelope.monthlyAllotment)}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  {isSavingsHub ? "Balance" : "Remaining"}
                </span>
                <span className="text-lg font-semibold" style={{ color: healthColor }}>
                  {formatUsd(balance)}
                </span>
              </div>
            </div>
            <div className="w-full min-w-0">
              <Progress
                value={Math.min(100, progressPct)}
                markerPct={monthMarkerPct}
                className="h-2"
                style={{
                  // @ts-expect-error - CSS custom properties
                  "--progress-color": healthColor,
                }}
              />
            </div>
          </div>
        </div>
        <TransactionsCashFlowPanel />
      </div>

      <TransactionsPage key={envelope.id} scopedEnvelopeId={envelope.id} />
    </div>
  )
}
