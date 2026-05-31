"use client"

import { useEffect, useMemo, useState } from "react"
import { useApp } from "@/lib/app-context"
import { getCurrentMonthKey, getEnvelopeBalance } from "@/lib/data"
import { findSavingsEnvelope, savingsBalance } from "@/lib/savings-ui-metrics"
import {
  AllocationStackedBar,
  type AllocationBarSegment,
} from "@/components/allocation-stacked-bar"
import { FillEnvelopesDialog, behaviorLabel, type FillEnvelopePreviewRow } from "@/components/fill-envelopes-dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import type { DistributionBehavior } from "@/lib/move-funds-math"
import { computeDistribution } from "@/lib/move-funds-math"

export interface MoveFundsPanelConfig {
  distributionBehavior: DistributionBehavior
  fundOverageFromSavings: boolean
  previewRows: FillEnvelopePreviewRow[]
}

export function MoveFundsPanel({
  grossUsd,
  sourceFunding,
  onConfigChange,
}: {
  grossUsd: number
  sourceFunding: "income" | "savings"
  onConfigChange: (config: MoveFundsPanelConfig) => void
}) {
  const { discretionaryEnvelopes, activeEnvelopes, activeTransactions } = useApp()
  const monthKey = getCurrentMonthKey()
  const savingsEnv = findSavingsEnvelope(activeEnvelopes) ?? null
  const savingsBal = savingsBalance(activeTransactions, savingsEnv?.id)

  const [behavior, setBehavior] = useState<DistributionBehavior>("set_to_budget")
  const [fundOverage, setFundOverage] = useState(false)
  const [fillOpen, setFillOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleFrequency, setScheduleFrequency] = useState("monthly")
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null)

  const preview = useMemo(() => {
    const envelopes = discretionaryEnvelopes.map((e) => ({
      id: e.id,
      monthlyAllotment: e.monthlyAllotment,
      currentMonthBalance: getEnvelopeBalance(activeTransactions, e.id, monthKey),
    }))
    const dist = computeDistribution({
      behavior,
      envelopes,
      grossUsd: sourceFunding === "income" ? grossUsd : 0,
      savingsBalance: savingsBal,
      fundOverageFromSavings: fundOverage,
    })
    const rows: FillEnvelopePreviewRow[] = dist.lines.map((line) => ({
      envelopeId: line.envelopeId,
      deltaUsd: line.deltaUsd,
      behaviorLabel: behaviorLabel(behavior),
    }))
    return { dist, rows }
  }, [
    behavior,
    fundOverage,
    grossUsd,
    sourceFunding,
    savingsBal,
    discretionaryEnvelopes,
    activeTransactions,
    monthKey,
  ])

  useEffect(() => {
    onConfigChange({
      distributionBehavior: behavior,
      fundOverageFromSavings: fundOverage,
      previewRows: preview.rows,
    })
  }, [behavior, fundOverage, preview.rows, onConfigChange])

  const barSegments: AllocationBarSegment[] = useMemo(() => {
    return discretionaryEnvelopes.map((env) => {
      const row = preview.rows.find((r) => r.envelopeId === env.id)
      const current = getEnvelopeBalance(activeTransactions, env.id, monthKey)
      return {
        id: env.id,
        name: env.name,
        color: env.color,
        icon: env.icon,
        value: current + (row?.deltaUsd ?? 0),
      }
    })
  }, [discretionaryEnvelopes, activeTransactions, monthKey, preview.rows])

  const poolTotal =
    (sourceFunding === "income" ? grossUsd : 0) +
    barSegments.reduce((s, x) => s + x.value, 0)

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-[#333] p-4 bg-[#0D0D0D]/50">
      <AllocationStackedBar
        envelopes={barSegments}
        savingsValue={sourceFunding === "income" ? Math.max(0, grossUsd - preview.dist.totalNeed) : savingsBal}
        totalValue={poolTotal > 0 ? poolTotal : 1}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">How should envelopes be filled?</legend>
        {(
          [
            ["set_to_budget", "Set to budget amount"],
            ["add_budget", "Add full budget amount"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name="distribution-behavior"
              checked={behavior === value}
              onChange={() => setBehavior(value)}
              className="accent-[#F7931A]"
            />
            {label}
          </label>
        ))}
      </fieldset>

      {sourceFunding === "income" ? (
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="fund-overage" className="text-sm text-muted-foreground">
            Fund any overage from Savings
          </Label>
          <Switch
            id="fund-overage"
            checked={fundOverage}
            onCheckedChange={setFundOverage}
            disabled={savingsBal <= 0}
          />
        </div>
      ) : null}

      {preview.dist.invalid ? (
        <p className="text-sm text-destructive">Not enough in Savings to cover this distribution.</p>
      ) : null}

      {preview.rows.length > 0 ? (
        <button
          type="button"
          className="text-sm text-[#3B82F6] hover:underline text-left"
          onClick={() => setFillOpen(true)}
        >
          View {preview.rows.length} affected envelope{preview.rows.length === 1 ? "" : "s"} →
        </button>
      ) : (
        <p className="text-sm text-muted-foreground">No envelope top-ups needed with this option.</p>
      )}

      <FillEnvelopesDialog
        open={fillOpen}
        onOpenChange={setFillOpen}
        rows={preview.rows}
        grossUsd={grossUsd}
        readOnly
      />

      <div className="border-t border-[#333] pt-3">
        <button
          type="button"
          className="text-sm font-medium text-foreground"
          onClick={() => setScheduleOpen((o) => !o)}
        >
          {scheduleOpen ? "Hide schedule" : "Schedule this"}
        </button>
        {scheduleOpen ? (
          <div className="mt-3 flex flex-col gap-2">
            <label className="text-xs text-muted-foreground">
              Frequency
              <select
                className="mt-1 w-full rounded-lg border border-[#333] bg-[#1A1A1A] px-2 py-2 text-sm"
                value={scheduleFrequency}
                onChange={(e) => setScheduleFrequency(e.target.value)}
              >
                <option value="weekly">Weekly</option>
                <option value="bimonthly">Twice a month</option>
                <option value="monthly">Monthly</option>
                <option value="every_2mo">Every 2 months</option>
                <option value="every_3mo">Every 3 months</option>
                <option value="every_6mo">Every 6 months</option>
                <option value="annually">Annually</option>
              </select>
            </label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={scheduleSaving}
              onClick={async () => {
                setScheduleSaving(true)
                setScheduleMessage(null)
                try {
                  const res = await fetch("/api/recurring-rules", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      kind: sourceFunding === "income" ? "income_distribution" : "move_funds",
                      frequency: scheduleFrequency,
                      distributionConfig: {
                        distributionBehavior: behavior,
                        fundOverageFromSavings: fundOverage,
                      },
                    }),
                  })
                  if (!res.ok) {
                    setScheduleMessage("Could not save schedule.")
                    return
                  }
                  setScheduleMessage("Saved. Manage under Settings → Budgeting rules.")
                } catch {
                  setScheduleMessage("Network error.")
                } finally {
                  setScheduleSaving(false)
                }
              }}
            >
              {scheduleSaving ? "Saving…" : "Save schedule"}
            </Button>
            {scheduleMessage ? (
              <p className="text-xs text-muted-foreground">{scheduleMessage}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
