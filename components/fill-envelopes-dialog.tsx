"use client"

import { useMemo, useState } from "react"
import { useApp } from "@/lib/app-context"
import {
  formatUsd,
  formatUsdPrecise,
  getCurrentMonthKey,
  getEnvelopeBalance,
  type Envelope,
} from "@/lib/data"
import { envelopeBudgetProgressPct } from "@/lib/envelope-card-metrics"
import {
  AllocationStackedBar,
  type AllocationBarSegment,
} from "@/components/allocation-stacked-bar"
import { EnvelopeIconDisplay } from "@/components/envelope-icon-display"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { DistributionBehavior } from "@/lib/move-funds-math"

export interface FillEnvelopePreviewRow {
  envelopeId: string
  deltaUsd: number
  behaviorLabel: string
}

export function FillEnvelopesDialog({
  open,
  onOpenChange,
  rows,
  grossUsd,
  readOnly = false,
  onConfirm,
  confirmLabel = "Confirm",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  rows: FillEnvelopePreviewRow[]
  grossUsd: number
  readOnly?: boolean
  onConfirm?: () => void
  confirmLabel?: string
}) {
  const { discretionaryEnvelopes, activeTransactions } = useApp()
  const [search, setSearch] = useState("")
  const monthKey = getCurrentMonthKey()

  const rowById = useMemo(() => new Map(rows.map((r) => [r.envelopeId, r])), [rows])

  const affected = useMemo(() => {
    return discretionaryEnvelopes
      .filter((e) => rowById.has(e.id))
      .map((env) => {
        const row = rowById.get(env.id)!
        const current = getEnvelopeBalance(activeTransactions, env.id, monthKey)
        const finalBal = current + row.deltaUsd
        return { env, row, current, finalBal }
      })
  }, [discretionaryEnvelopes, activeTransactions, monthKey, rowById])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return affected
    return affected.filter((a) => a.env.name.toLowerCase().includes(q))
  }, [affected, search])

  const barSegments: AllocationBarSegment[] = useMemo(() => {
    return affected.map((a) => ({
      id: a.env.id,
      name: a.env.name,
      color: a.env.color,
      icon: a.env.icon,
      value: a.finalBal,
    }))
  }, [affected])

  const totalBar = barSegments.reduce((s, x) => s + x.value, 0) + Math.max(0, grossUsd - rows.reduce((s, r) => s + r.deltaUsd, 0))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(96vw,32rem)] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{readOnly ? "Review distribution" : "Affected envelopes"}</DialogTitle>
        </DialogHeader>

        <AllocationStackedBar
          envelopes={barSegments}
          savingsValue={Math.max(0, grossUsd - rows.reduce((s, r) => s + r.deltaUsd, 0))}
          totalValue={totalBar > 0 ? totalBar : 1}
        />

        <Input
          placeholder="Search envelopes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-[#1A1A1A] border-[#333]"
        />

        <div className="flex-1 min-h-0 overflow-y-auto grid gap-3 sm:grid-cols-2">
          {filtered.map(({ env, row, current, finalBal }) => (
            <EnvelopePreviewTile
              key={env.id}
              env={env}
              behaviorLabel={row.behaviorLabel}
              current={current}
              delta={row.deltaUsd}
              finalBal={finalBal}
              monthlyAllotment={env.monthlyAllotment}
            />
          ))}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Back
          </Button>
          {onConfirm ? (
            <Button type="button" onClick={onConfirm} disabled={readOnly && false}>
              {confirmLabel}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EnvelopePreviewTile({
  env,
  behaviorLabel,
  current,
  delta,
  finalBal,
  monthlyAllotment,
}: {
  env: Envelope
  behaviorLabel: string
  current: number
  delta: number
  finalBal: number
  monthlyAllotment: number
}) {
  const progress = envelopeBudgetProgressPct(finalBal, monthlyAllotment)
  return (
    <div
      className="rounded-xl p-3 border border-[#333] min-w-0"
      style={{ backgroundColor: `${env.color}18` }}
    >
      <div className="flex items-center gap-2 mb-2">
        <EnvelopeIconDisplay icon={env.icon} fallbackName={env.name} className="h-5 w-5" />
        <span className="font-medium text-sm truncate">{env.name}</span>
      </div>
      <span className="text-xs text-muted-foreground block mb-1">{behaviorLabel}</span>
      <p className="text-xs font-mono">
        {formatUsd(current)} → {formatUsdPrecise(delta)} → {formatUsd(finalBal)}
      </p>
      <div className="mt-2 h-1.5 rounded-full bg-[#1A1A1A] overflow-hidden relative">
        <div
          className="absolute inset-y-0 left-0 opacity-40"
          style={{ width: `${Math.min(100, envelopeBudgetProgressPct(current, monthlyAllotment))}%`, backgroundColor: env.color }}
        />
        <div
          className="absolute inset-y-0 left-0"
          style={{ width: `${Math.min(100, progress)}%`, backgroundColor: env.color }}
        />
      </div>
    </div>
  )
}

export function behaviorLabel(behavior: DistributionBehavior): string {
  switch (behavior) {
    case "set_to_budget":
      return "Set to budget"
    case "add_budget":
      return "Add budget"
    case "custom":
      return "Custom"
    default: {
      const _x: never = behavior
      return _x
    }
  }
}
