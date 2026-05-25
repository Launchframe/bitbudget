"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useApp } from "@/lib/app-context"
import { getEnvelopeBalanceAllTime, formatUsd } from "@/lib/data"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EnvelopeIconDisplay } from "@/components/envelope-icon-display"
import {
  resolveEffectiveSweepPolicy,
  resolveSweepCapMultiplier,
  suggestedManualSweepAmount,
} from "@/lib/envelope-sweep"
import {
  SWEEP_POLICY_CAPPED,
  SWEEP_POLICY_CARRY_FORWARD,
  SWEEP_POLICY_RESET,
} from "@/lib/constants"
import { Sparkles } from "lucide-react"

interface SweepRow {
  envelopeId: string
  name: string
  color: string
  icon?: string | null
  monthlyAllotment: number
  maxAmount: number
  suggestedAmount: number
  checked: boolean
  amount: string
}

function envelopeHealthColor(percentage: number): string {
  return percentage > 25 ? "#22C55E" : percentage > 10 ? "#EAB308" : "#EF4444"
}

function SweepEnvelopeHealthBar({
  name,
  monthlyAllotment,
  currentBalance,
  sweepAmount,
}: {
  name: string
  monthlyAllotment: number
  currentBalance: number
  sweepAmount: number
}) {
  if (monthlyAllotment <= 0) return null

  const currentPct = Math.min(100, Math.max(0, (currentBalance / monthlyAllotment) * 100))
  const afterBalance = Math.max(0, currentBalance - sweepAmount)
  const afterPct = Math.min(100, Math.max(0, (afterBalance / monthlyAllotment) * 100))
  const sweepPct = Math.max(0, currentPct - afterPct)
  const afterColor = envelopeHealthColor(afterPct)
  const currentColor = envelopeHealthColor(currentPct)

  return (
    <div
      className="relative h-2 w-full rounded-full bg-[#1F1F1F] overflow-hidden"
      role="img"
      aria-label={`${name}: ${Math.round(currentPct)}% budget left now${
        sweepAmount > 0 ? `, ${Math.round(afterPct)}% after sweep` : ""
      }`}
    >
      {currentPct > 0 && (
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-200"
          style={{
            width: `${currentPct}%`,
            backgroundColor: currentColor,
            opacity: sweepPct > 0 ? 0.35 : 1,
          }}
        />
      )}
      {afterPct > 0 && (
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-200"
          style={{
            width: `${afterPct}%`,
            backgroundColor: afterColor,
          }}
        />
      )}
    </div>
  )
}

type SweepDefaults = {
  sweepDefaultPolicy: string
  sweepDefaultCapMultiplier: number
}

async function loadSweepDefaults(): Promise<SweepDefaults> {
  try {
    const res = await fetch("/api/user/settings")
    if (!res.ok) {
      return { sweepDefaultPolicy: SWEEP_POLICY_RESET, sweepDefaultCapMultiplier: 1.5 }
    }
    const settings = (await res.json()) as {
      sweepDefaultPolicy?: string
      sweepDefaultCapMultiplier?: number | null
    }
    const policy =
      settings.sweepDefaultPolicy === SWEEP_POLICY_RESET ||
      settings.sweepDefaultPolicy === SWEEP_POLICY_CARRY_FORWARD ||
      settings.sweepDefaultPolicy === SWEEP_POLICY_CAPPED
        ? settings.sweepDefaultPolicy
        : SWEEP_POLICY_RESET
    const cap =
      settings.sweepDefaultCapMultiplier != null &&
      Number.isFinite(settings.sweepDefaultCapMultiplier)
        ? settings.sweepDefaultCapMultiplier
        : 1.5
    return { sweepDefaultPolicy: policy, sweepDefaultCapMultiplier: cap }
  } catch {
    return { sweepDefaultPolicy: SWEEP_POLICY_RESET, sweepDefaultCapMultiplier: 1.5 }
  }
}

interface EnvelopeSweepDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (total: number) => void
}

export function EnvelopeSweepDialog({ open, onOpenChange, onSuccess }: EnvelopeSweepDialogProps) {
  const { state, discretionaryEnvelopes, refreshData } = useApp()
  const [rows, setRows] = useState<SweepRow[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successFlash, setSuccessFlash] = useState(false)

  const buildRows = useCallback(
    (defaults: SweepDefaults): SweepRow[] => {
      const asOf = new Date()
      return discretionaryEnvelopes
        .map((env) => {
          const balance = getEnvelopeBalanceAllTime(state.transactions, env.id)
          const maxAmount = Math.max(0, balance)
          const policy = resolveEffectiveSweepPolicy(env.sweepPolicy, defaults.sweepDefaultPolicy)
          const capMultiplier = resolveSweepCapMultiplier(
            env.sweepCapMultiplier,
            defaults.sweepDefaultCapMultiplier,
          )
          const suggestedAmount = suggestedManualSweepAmount({
            balance,
            policy,
            monthlyAllotment: env.monthlyAllotment,
            capMultiplier,
            asOf,
          })
          return {
            envelopeId: env.id,
            name: env.name,
            color: env.color,
            icon: env.icon,
            monthlyAllotment: env.monthlyAllotment,
            maxAmount,
            suggestedAmount,
            checked: suggestedAmount > 0,
            amount: maxAmount > 0 ? suggestedAmount.toFixed(2) : "0",
          }
        })
        .filter((r) => r.maxAmount > 0)
    },
    [discretionaryEnvelopes, state.transactions],
  )

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      const defaults = await loadSweepDefaults()
      if (cancelled) return
      setRows(buildRows(defaults))
      setError(null)
      setSuccessFlash(false)
    })()
    return () => {
      cancelled = true
    }
  }, [open, buildRows])

  const totalSweep = useMemo(() => {
    return rows.reduce((sum, row) => {
      if (!row.checked) return sum
      const amt = parseFloat(row.amount)
      return sum + (Number.isFinite(amt) ? Math.min(amt, row.maxAmount) : 0)
    }, 0)
  }, [rows])

  const toggleRow = (envelopeId: string, checked: boolean) => {
    setRows((prev) => prev.map((r) => (r.envelopeId === envelopeId ? { ...r, checked } : r)))
  }

  const setRowAmount = (envelopeId: string, amount: string) => {
    setRows((prev) => prev.map((r) => (r.envelopeId === envelopeId ? { ...r, amount } : r)))
  }

  const submit = async () => {
    setError(null)
    const entries = rows
      .filter((r) => r.checked)
      .map((r) => {
        const amt = parseFloat(r.amount)
        if (!Number.isFinite(amt) || amt <= 0) return null
        return { envelopeId: r.envelopeId, amount: Math.min(amt, r.maxAmount) }
      })
      .filter((e): e is { envelopeId: string; amount: number } => e != null)

    if (entries.length === 0) {
      setError("Select at least one envelope with a positive amount.")
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch("/api/transactions/envelope-sweep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Could not sweep envelopes.")
        return
      }
      setSuccessFlash(true)
      await refreshData()
      onSuccess?.(totalSweep)
      setTimeout(() => {
        setSuccessFlash(false)
        onOpenChange(false)
      }, 900)
    } catch {
      setError("Network error — try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#D4AF37]" aria-hidden />
            Sweep to Savings
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Move leftover envelope balances into Savings. Each sweep creates visible transactions in your history.
        </p>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No envelopes have a positive balance to sweep.</p>
        ) : (
          <div className="flex flex-col gap-2 max-h-[min(24rem,50vh)] overflow-y-auto">
            {rows.map((row) => {
              const sweepAmt = row.checked
                ? Math.min(
                    row.maxAmount,
                    Math.max(0, parseFloat(row.amount) || 0),
                  )
                : 0
              const afterBalance = Math.max(0, row.maxAmount - sweepAmt)

              return (
              <label
                key={row.envelopeId}
                className={`flex flex-col gap-2 p-3 rounded-xl border transition-colors ${
                  row.checked ? "border-[#D4AF37]/40 bg-[#D4AF37]/5" : "border-[#1F1F1F] bg-[#111]"
                } ${successFlash ? "animate-pulse" : ""}`}
              >
                <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={row.checked}
                  onChange={(e) => toggleRow(row.envelopeId, e.target.checked)}
                  className="rounded border-[#333]"
                  aria-label={`Sweep ${row.name}`}
                />
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${row.color}22` }}
                >
                  <EnvelopeIconDisplay
                    icon={row.icon}
                    fallbackName={row.name}
                    className="h-3.5 w-3.5 text-[9px]"
                    style={{ color: row.color }}
                  />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-sm font-medium truncate">{row.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatUsd(row.maxAmount)} → {formatUsd(afterBalance)} left
                  </span>
                </div>
                <Input
                  type="number"
                  min={0}
                  max={row.maxAmount}
                  step="0.01"
                  value={row.amount}
                  disabled={!row.checked}
                  onChange={(e) => setRowAmount(row.envelopeId, e.target.value)}
                  className="w-24 h-8 bg-[#1A1A1A] border-[#333] text-sm"
                  aria-label={`Amount to sweep from ${row.name}`}
                />
                </div>
                {row.monthlyAllotment > 0 && (
                  <SweepEnvelopeHealthBar
                    name={row.name}
                    monthlyAllotment={row.monthlyAllotment}
                    currentBalance={row.maxAmount}
                    sweepAmount={sweepAmt}
                  />
                )}
              </label>
            )})}
          </div>
        )}

        {rows.length > 0 && (
          <p className="text-sm text-foreground">
            You&apos;ll send{" "}
            <span className="font-semibold text-[#D4AF37]">{formatUsd(totalSweep, 2)}</span> to Savings.
          </p>
        )}

        {error && (
          <p className="text-sm text-amber-400/95" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-[#D4AF37] text-[#0D0D0D] hover:bg-[#D4AF37]/90"
            disabled={submitting || rows.length === 0}
            onClick={() => void submit()}
          >
            {submitting ? "Sweeping…" : successFlash ? "Done!" : "Confirm sweep"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
