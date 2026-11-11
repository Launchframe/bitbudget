"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatUsd } from "@/lib/data"
import {
  paycheckShortfallCoverage,
  refillOptions,
  type RefillOption,
  type RefillOptionKind,
} from "@/lib/runway-refill"
import type { StackInput } from "@/lib/loan-health"
import { ArrowRight, Bitcoin, Landmark, RefreshCw, Wallet } from "lucide-react"

const SATS_PER_BTC = 100_000_000

const KIND_META: Record<
  RefillOptionKind,
  { title: string; icon: React.ReactNode; blurb: string }
> = {
  sell: {
    title: "Sell some bitcoin",
    icon: <Bitcoin className="h-4 w-4" aria-hidden />,
    blurb: "Turn a slice of bitcoin into cash. Your total stays about the same.",
  },
  borrow: {
    title: "Borrow against bitcoin",
    icon: <Landmark className="h-4 w-4" aria-hidden />,
    blurb: "Keep your bitcoin and take cash against it instead of selling.",
  },
  rollover: {
    title: "Draw on bitcoin you've already pledged",
    icon: <RefreshCw className="h-4 w-4" aria-hidden />,
    blurb: "Use the spare borrowing room on bitcoin already with a lender.",
  },
}

function satsToBtcLabel(sats: number): string {
  if (sats <= 0) return "0"
  const btc = sats / SATS_PER_BTC
  return btc.toLocaleString("en-US", { maximumFractionDigits: 8 })
}

/**
 * Refill the cash floor when it slips underneath (slice B6). Opened from Runway
 * when the shortfall is positive. The amount starts at the shortfall but is
 * editable; each choice shows what moves and the stack before → after so the
 * user can see nothing really disappears. Nothing happens until Confirm:
 *  - Sell   → records a pending sale (coins on the way until the deposit links).
 *  - Borrow / rollover → hands off to the loan form, prefilled with the sized
 *    amount, so real loan terms are captured before anything is created.
 */
export function RunwayRefillDialog({
  open,
  onOpenChange,
  shortfallUsd,
  btcPriceUsd,
  priceKnown,
  borrowCapFraction,
  stack,
  rolloverCollateralSats,
  openLoanAmountDueUsd,
  preferBorrow,
  nextPaycheckUsd,
  onSaleCreated,
  onStartBorrow,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  shortfallUsd: number
  btcPriceUsd: number
  priceKnown: boolean
  borrowCapFraction: number
  stack: StackInput
  rolloverCollateralSats: number
  openLoanAmountDueUsd: number
  preferBorrow: boolean
  nextPaycheckUsd: number
  onSaleCreated: () => void
  onStartBorrow: (prefill: { principalUsd: number; collateralBtc: number }) => void
}) {
  const [amount, setAmount] = useState("")
  const [selectedKind, setSelectedKind] = useState<RefillOptionKind | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seed the amount from the shortfall when the dialog opens. Deferred so the
  // effect body sets no state synchronously (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      setAmount(shortfallUsd > 0 ? String(Math.round(shortfallUsd * 100) / 100) : "")
      setSelectedKind(null)
      setError(null)
    }, 0)
    return () => clearTimeout(t)
  }, [open, shortfallUsd])

  const amountNum = Math.max(0, parseFloat(amount) || 0)

  const options = useMemo(
    () =>
      refillOptions({
        shortfallUsd: amountNum,
        btcPriceUsd,
        borrowCapFraction,
        stack,
        rolloverCollateralSats,
        openLoanAmountDueUsd,
        preferBorrow,
      }),
    [
      amountNum,
      btcPriceUsd,
      borrowCapFraction,
      stack,
      rolloverCollateralSats,
      openLoanAmountDueUsd,
      preferBorrow,
    ],
  )

  // Resolve the active choice: the user's pick if still available, else the
  // first available option.
  const firstAvailable = options.find((o) => o.available) ?? null
  const active: RefillOption | null =
    options.find((o) => o.kind === selectedKind && o.available) ?? firstAvailable

  const paycheck =
    nextPaycheckUsd > 0 ? paycheckShortfallCoverage(amountNum, nextPaycheckUsd) : null

  const confirm = useCallback(async () => {
    if (!active || !active.available) return
    setError(null)
    if (active.kind === "sell") {
      if (!priceKnown || active.satsMoved <= 0) {
        setError("We need a live bitcoin price to record a sale.")
        return
      }
      setSaving(true)
      try {
        const res = await fetch("/api/runway/pending-sales", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sats: active.satsMoved, markPriceUsd: btcPriceUsd }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(typeof data.error === "string" ? data.error : "Couldn't start the sale.")
          return
        }
        onSaleCreated()
        onOpenChange(false)
      } catch {
        setError("Network error — try again.")
      } finally {
        setSaving(false)
      }
      return
    }
    // Borrow / rollover: hand off to the loan form prefilled with the sized
    // amount so real terms (rate, due date, sell price) are captured there.
    onStartBorrow({
      principalUsd: Math.round(active.cashRaisedUsd * 100) / 100,
      collateralBtc: active.satsMoved / SATS_PER_BTC,
    })
    onOpenChange(false)
  }, [active, priceKnown, btcPriceUsd, onSaleCreated, onStartBorrow, onOpenChange])

  const confirmLabel = !active
    ? "Pick a way to refill"
    : active.kind === "sell"
      ? "Confirm sale"
      : "Set up the loan"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground max-w-[min(96vw,32rem)] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Refill your cash floor</DialogTitle>
          <DialogDescription>
            Your cash is under the cushion you set aside. Pick how to top it back
            up — nothing happens until you confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 pt-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="refill-amount">How much to refill</Label>
            <Input
              id="refill-amount"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="bg-[#1A1A1A] border-[#333]"
            />
            <p className="text-xs text-muted-foreground">
              Starts at what you&apos;re short. Change it if you&apos;d like a bigger or
              smaller cushion.
            </p>
          </div>

          {paycheck && paycheck.coveredUsd > 0.5 && (
            <p className="text-xs text-[#22C55E]">
              {paycheck.coversFull
                ? "Your next paycheck would cover all of this on its own."
                : `Your next paycheck covers about ${formatUsd(paycheck.coveredUsd)} of this.`}
            </p>
          )}

          <div className="flex flex-col gap-2" role="radiogroup" aria-label="How to refill">
            {options.map((opt) => {
              const meta = KIND_META[opt.kind]
              const isActive = active?.kind === opt.kind
              const stackMoves = Math.abs(opt.stackAfterUsd - opt.stackBeforeUsd) > 0.5
              return (
                <button
                  key={opt.kind}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  disabled={!opt.available}
                  onClick={() => setSelectedKind(opt.kind)}
                  className={`text-left rounded-xl border p-3 transition-colors min-w-0 ${
                    !opt.available
                      ? "border-[#1F1F1F] opacity-60 cursor-not-allowed"
                      : isActive
                        ? "border-[#F7931A] bg-[#F7931A]/10"
                        : "border-[#333] hover:border-[#555]"
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <span className="text-[#F7931A] shrink-0">{meta.icon}</span>
                    <span className="min-w-0">{meta.title}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {opt.available ? meta.blurb : opt.unavailableReason}
                  </p>
                  {opt.available && (
                    <div className="mt-2 flex flex-col gap-1 text-xs">
                      <span className="text-foreground">
                        Raises {formatUsd(opt.cashRaisedUsd)}
                        {!opt.coversFullShortfall && amountNum > 0 && (
                          <span className="text-amber-400">
                            {" "}
                            — covers part of {formatUsd(amountNum)}
                          </span>
                        )}
                      </span>
                      {opt.kind === "sell" && (
                        <span className="text-muted-foreground">
                          Sells about {satsToBtcLabel(opt.satsMoved)} BTC
                        </span>
                      )}
                      {opt.kind === "borrow" && (
                        <span className="text-muted-foreground">
                          Pledges about {satsToBtcLabel(opt.satsMoved)} BTC as collateral
                        </span>
                      )}
                      <span className="flex items-center gap-1.5 text-muted-foreground tabular-nums">
                        <Wallet className="h-3 w-3 shrink-0" aria-hidden />
                        {formatUsd(opt.stackBeforeUsd)}
                        <ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
                        {formatUsd(opt.stackAfterUsd)}
                        <span className="text-[11px]">
                          {stackMoves ? "" : "(your total stays the same)"}
                        </span>
                      </span>
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {error && (
            <p className="text-sm text-amber-400/95" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/90 w-full sm:w-auto"
            onClick={() => void confirm()}
            disabled={saving || !active || amountNum <= 0}
          >
            {saving ? "Starting…" : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
