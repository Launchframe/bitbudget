"use client"

import { useCallback, useMemo, useState } from "react"
import { useApp } from "@/lib/app-context"
import {
  formatUsd,
  getCurrentMonthKey,
  getEnvelopeBalance,
} from "@/lib/data"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  AllocationStackedBar,
  type AllocationBarSegment,
} from "@/components/allocation-stacked-bar"
import { EnvelopeIconDisplay } from "@/components/envelope-icon-display"
import { FillEnvelopesDialog, type FillEnvelopePreviewRow } from "@/components/fill-envelopes-dialog"

type MoveMode = "balanced" | "independent"

export function MoveFundsDialog({
  open,
  onOpenChange,
  source = "pool",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `savings` opens with fund-from-savings behavior via independent deltas */
  source?: "pool" | "savings"
}) {
  const { discretionaryEnvelopes, activeTransactions, refreshData } = useApp()
  const monthKey = getCurrentMonthKey()
  const [mode, setMode] = useState<MoveMode>("balanced")
  const [multiplier, setMultiplier] = useState(1)
  const [deltas, setDeltas] = useState<Record<string, number>>({})
  const [fillOpen, setFillOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const getBalance = useCallback(
    (id: string) => getEnvelopeBalance(activeTransactions, id, monthKey),
    [activeTransactions, monthKey],
  )

  const beforeSegments: AllocationBarSegment[] = useMemo(
    () =>
      discretionaryEnvelopes.map((e) => ({
        id: e.id,
        name: e.name,
        color: e.color,
        icon: e.icon,
        value: Math.max(0, getBalance(e.id)),
      })),
    [discretionaryEnvelopes, getBalance],
  )

  const afterSegments: AllocationBarSegment[] = useMemo(
    () =>
      discretionaryEnvelopes.map((e) => ({
        id: e.id,
        name: e.name,
        color: e.color,
        icon: e.icon,
        value: Math.max(0, getBalance(e.id) + (deltas[e.id] ?? 0)),
      })),
    [discretionaryEnvelopes, getBalance, deltas],
  )

  const entries = useMemo(() => {
    return Object.entries(deltas)
      .filter(([, d]) => Number.isFinite(d) && Math.abs(d) > 0.005)
      .map(([envelopeId, deltaUsd]) => ({ envelopeId, deltaUsd }))
  }, [deltas])

  const previewRows: FillEnvelopePreviewRow[] = entries.map((e) => ({
    envelopeId: e.envelopeId,
    deltaUsd: e.deltaUsd,
    behaviorLabel: "Move funds",
  }))

  const submit = async () => {
    setError(null)
    if (entries.length === 0) {
      setError("Adjust at least one envelope.")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/transactions/move-funds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, entries }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not move funds.")
        return
      }
      await refreshData()
      setSuccess(true)
    } catch {
      setError("Network error — try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const reset = () => {
    setDeltas({})
    setError(null)
    setSuccess(false)
    setMode(source === "savings" ? "independent" : "balanced")
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next)
          if (!next) reset()
        }}
      >
        <DialogContent className="max-w-[min(96vw,32rem)] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{source === "savings" ? "Fund from Savings" : "Move funds"}</DialogTitle>
          </DialogHeader>

          {success ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">Funds moved successfully.</p>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <AllocationStackedBar
                  variant="before"
                  envelopes={beforeSegments}
                  savingsValue={0}
                  totalValue={beforeSegments.reduce((s, x) => s + x.value, 0) || 1}
                />
                <AllocationStackedBar
                  variant="after"
                  envelopes={afterSegments}
                  savingsValue={0}
                  totalValue={afterSegments.reduce((s, x) => s + x.value, 0) || 1}
                />
              </div>

              <div className="flex gap-2 flex-wrap">
                <Button
                  type="button"
                  size="sm"
                  variant={mode === "balanced" ? "default" : "outline"}
                  onClick={() => setMode("balanced")}
                >
                  Balanced
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={mode === "independent" ? "default" : "outline"}
                  onClick={() => setMode("independent")}
                >
                  Choose each
                </Button>
              </div>

              <div className="flex gap-1 flex-wrap">
                {[1, 2, 3, 5, 10].map((m) => (
                  <Button
                    key={m}
                    type="button"
                    size="sm"
                    variant={multiplier === m ? "secondary" : "outline"}
                    onClick={() => setMultiplier(m)}
                  >
                    {m}×
                  </Button>
                ))}
              </div>

              <div className="flex flex-col gap-3 max-h-[40vh] overflow-y-auto">
                {discretionaryEnvelopes.map((env) => {
                  const bal = getBalance(env.id)
                  const max = env.monthlyAllotment * multiplier
                  const delta = deltas[env.id] ?? 0
                  return (
                    <div key={env.id} className="rounded-xl border border-[#333] p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <EnvelopeIconDisplay icon={env.icon} fallbackName={env.name} className="h-5 w-5" />
                        <span className="text-sm font-medium truncate">{env.name}</span>
                        <span className="text-xs text-muted-foreground ml-auto">{formatUsd(bal)}</span>
                      </div>
                      {bal < 0 ? (
                        <p className="text-xs text-amber-400 mb-1">In deficit this month: {formatUsd(bal)}</p>
                      ) : null}
                      <Label className="text-xs">Change (+/−)</Label>
                      <input
                        type="range"
                        min={0}
                        max={max}
                        step={0.01}
                        value={Math.max(0, delta)}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value)
                          setDeltas((prev) => ({ ...prev, [env.id]: v }))
                        }}
                        className="w-full"
                      />
                      <span className="text-xs font-mono">{formatUsd(delta)}</span>
                    </div>
                  )
                })}
              </div>

              {entries.length > 0 ? (
                <button
                  type="button"
                  className="text-sm text-[#3B82F6] hover:underline text-left"
                  onClick={() => setFillOpen(true)}
                >
                  View {entries.length} affected envelopes →
                </button>
              ) : null}

              {error ? (
                <p className="text-sm text-amber-400/95" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="button" disabled={submitting} onClick={() => void submit()}>
                  {submitting ? "Saving…" : "Move funds"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <FillEnvelopesDialog
        open={fillOpen}
        onOpenChange={setFillOpen}
        rows={previewRows}
        grossUsd={entries.reduce((s, e) => s + Math.max(0, e.deltaUsd), 0)}
        readOnly
      />
    </>
  )
}
