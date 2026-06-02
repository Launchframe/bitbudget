"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { useApp } from "@/lib/app-context"
import {
  formatUsd,
  formatUsdPrecise,
  getCurrentMonthKey,
  getEnvelopeBalance,
  type Envelope,
} from "@/lib/data"
import { envelopeBudgetProgressPct } from "@/lib/envelope-card-metrics"
import type { DistributionInvalidReason } from "@/lib/rebalance-math"
import {
  AllocationStackedBar,
  type AllocationBarSegment,
} from "@/components/allocation-stacked-bar"
import { SavingsDrawdownSummary } from "@/components/savings-drawdown-summary"
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
import type { DistributionBehavior } from "@/lib/rebalance-math"
import { cn } from "@/lib/utils"
import { handleDialogEnterToPrimary } from "@/lib/dialog-enter-submit"

export interface FillEnvelopePreviewRow {
  envelopeId: string
  deltaUsd: number
  behaviorLabel: string
}

const PAGE_SIZE = 12

type SortMode =
  | "name_asc"
  | "name_desc"
  | "amount_high"
  | "amount_low"
  | "balance_high"
  | "balance_low"
  | "health_high"
  | "health_low"

function invalidBannerMessage(reason: DistributionInvalidReason | null): string {
  switch (reason) {
    case "insufficient_income":
      return "Your income cannot fully fund this distribution. Amounts below show what can be covered."
    case "insufficient_savings":
      return "Savings cannot cover the rest. Amounts below show what can be covered from income and Savings."
    case "no_income":
      return "Enter an income amount to preview a distribution."
    case "no_split_targets":
      return "Add a monthly amount to at least one spending envelope to split this deposit."
    default:
      return "This distribution cannot be fully funded. Amounts below show what can be covered."
  }
}

export function FillEnvelopesDialog({
  open,
  onOpenChange,
  rows,
  fundedRows,
  grossUsd,
  readOnly = false,
  onConfirm,
  confirmLabel = "Confirm",
  distributionInvalid = false,
  invalidReason = null,
  embedded = false,
  savingsDrawForSummaryUsd,
  savingsBalanceForSummaryUsd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  rows: FillEnvelopePreviewRow[]
  /** When set (e.g. invalid distribution), tiles and bar use funded amounts instead of requested rows. */
  fundedRows?: FillEnvelopePreviewRow[]
  grossUsd: number
  readOnly?: boolean
  onConfirm?: () => void
  confirmLabel?: string
  distributionInvalid?: boolean
  invalidReason?: DistributionInvalidReason | null
  /** Render body only (no Dialog wrapper) for confirm step embedding. */
  embedded?: boolean
  /** Optional: show draw-from-Savings vs balance strip (Add income / rebalance review). */
  savingsDrawForSummaryUsd?: number
  savingsBalanceForSummaryUsd?: number
}) {
  const { discretionaryEnvelopes, activeTransactions } = useApp()
  const [search, setSearch] = useState("")
  const [sortMode, setSortMode] = useState<SortMode>("amount_high")
  const [page, setPage] = useState(0)
  const monthKey = getCurrentMonthKey()
  const tileRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const displayRows = fundedRows && (distributionInvalid || fundedRows.length > 0) ? fundedRows : rows

  const rowById = useMemo(() => new Map(displayRows.map((r) => [r.envelopeId, r])), [displayRows])

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

  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = q ? affected.filter((a) => a.env.name.toLowerCase().includes(q)) : [...affected]
    list = [...list].sort((a, b) => {
      switch (sortMode) {
        case "name_asc":
          return a.env.name.localeCompare(b.env.name)
        case "name_desc":
          return b.env.name.localeCompare(a.env.name)
        case "balance_high":
          return b.finalBal - a.finalBal
        case "balance_low":
          return a.finalBal - b.finalBal
        case "health_high":
          return (
            envelopeBudgetProgressPct(b.finalBal, b.env.monthlyAllotment) -
            envelopeBudgetProgressPct(a.finalBal, a.env.monthlyAllotment)
          )
        case "health_low":
          return (
            envelopeBudgetProgressPct(a.finalBal, a.env.monthlyAllotment) -
            envelopeBudgetProgressPct(b.finalBal, b.env.monthlyAllotment)
          )
        case "amount_low":
          return a.row.deltaUsd - b.row.deltaUsd
        case "amount_high":
        default:
          return b.row.deltaUsd - a.row.deltaUsd
      }
    })
    return list
  }, [affected, search, sortMode])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const paged = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  const barSegments: AllocationBarSegment[] = useMemo(() => {
    return affected.map((a) => ({
      id: a.env.id,
      name: a.env.name,
      color: a.env.color,
      icon: a.env.icon,
      value: a.finalBal,
    }))
  }, [affected])

  const assignedTotal = displayRows.reduce((s, r) => s + r.deltaUsd, 0)
  const totalBar = barSegments.reduce((s, x) => s + x.value, 0) + Math.max(0, grossUsd - assignedTotal)

  const scrollToEnvelope = useCallback((envelopeId: string) => {
    const idx = sorted.findIndex((a) => a.env.id === envelopeId)
    if (idx < 0) return
    setPage(Math.floor(idx / PAGE_SIZE))
    requestAnimationFrame(() => {
      tileRefs.current[envelopeId]?.scrollIntoView({ behavior: "smooth", block: "nearest" })
    })
  }, [sorted])

  const body = (
    <>
      {distributionInvalid ? (
        <p className="text-sm text-amber-400/95 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2" role="alert">
          {invalidBannerMessage(invalidReason)}
        </p>
      ) : null}

      <AllocationStackedBar
        envelopes={barSegments}
        savingsValue={Math.max(0, grossUsd - assignedTotal)}
        totalValue={totalBar > 0 ? totalBar : 1}
        onSegmentClick={scrollToEnvelope}
      />

      {typeof savingsBalanceForSummaryUsd === "number" && Number.isFinite(savingsDrawForSummaryUsd ?? 0) ? (
        <SavingsDrawdownSummary
          drawFromSavingsUsd={Math.max(0, savingsDrawForSummaryUsd ?? 0)}
          savingsBalanceUsd={Math.max(0, savingsBalanceForSummaryUsd)}
        />
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          placeholder="Filter envelopes…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(0)
          }}
          className="bg-[#1A1A1A] border-[#333] flex-1 min-w-0"
        />
        <select
          className="rounded-lg border border-[#333] bg-[#1A1A1A] px-2 py-2 text-sm shrink-0"
          value={sortMode}
          onChange={(e) => {
            setSortMode(e.target.value as SortMode)
            setPage(0)
          }}
          aria-label="Sort envelopes"
        >
          <option value="amount_high">Amount (high to low)</option>
          <option value="amount_low">Amount (low to high)</option>
          <option value="name_asc">Name (A–Z)</option>
          <option value="name_desc">Name (Z–A)</option>
          <option value="balance_high">Balance (high to low)</option>
          <option value="balance_low">Balance (low to high)</option>
          <option value="health_high">Health (high to low)</option>
          <option value="health_low">Health (low to high)</option>
        </select>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto grid gap-3 sm:grid-cols-2">
        {paged.map(({ env, row, current, finalBal }) => (
          <div
            key={env.id}
            ref={(el) => {
              tileRefs.current[env.id] = el
            }}
          >
            <EnvelopePreviewTile
              env={env}
              behaviorLabel={row.behaviorLabel}
              current={current}
              delta={row.deltaUsd}
              finalBal={finalBal}
              monthlyAllotment={env.monthlyAllotment}
              understated={distributionInvalid && rows.some((r) => r.envelopeId === env.id && r.deltaUsd > row.deltaUsd + 0.01)}
            />
          </div>
        ))}
      </div>

      {pageCount > 1 ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={safePage <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <span className="text-muted-foreground text-xs">
            Page {safePage + 1} of {pageCount}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            Next
          </Button>
        </div>
      ) : null}
    </>
  )

  if (embedded) {
    if (!open) return null
    return (
      <div className="flex flex-col gap-4 min-w-0">
        {body}
        {onConfirm ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end shrink-0 border-t border-[#333] pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Back
            </Button>
            <Button type="button" onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[min(96vw,32rem)] max-h-[85vh] flex flex-col transition-all duration-200 ease-out"
        onKeyDown={(e) =>
          handleDialogEnterToPrimary(e, {
            disabled: readOnly || !onConfirm,
            onPrimary: () => {
              onConfirm?.()
            },
          })
        }
      >
        <DialogHeader>
          <DialogTitle>{readOnly ? "Rebalance preview" : "Affected envelopes"}</DialogTitle>
        </DialogHeader>

        {body}

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Back
          </Button>
          {onConfirm ? (
            <Button type="button" onClick={onConfirm}>
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
  understated,
}: {
  env: Envelope
  behaviorLabel: string
  current: number
  delta: number
  finalBal: number
  monthlyAllotment: number
  understated?: boolean
}) {
  const progress = envelopeBudgetProgressPct(finalBal, monthlyAllotment)
  return (
    <div
      className={cn(
        "rounded-xl p-3 border min-w-0",
        understated ? "border-amber-500/40" : "border-[#333]",
      )}
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
          style={{
            width: `${Math.min(100, envelopeBudgetProgressPct(current, monthlyAllotment))}%`,
            backgroundColor: env.color,
          }}
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
    case "split_income_proportional":
      return "Split by budget size"
    case "custom":
      return "Choose amounts"
    default: {
      const _x: never = behavior
      return _x
    }
  }
}
