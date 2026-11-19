"use client"

import { useCallback, useEffect, useState } from "react"
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { handleDialogEnterToPrimary } from "@/lib/dialog-enter-submit"
import { todayTransactionCalendarDay } from "@/lib/transaction-dates"
import { ChevronDown } from "lucide-react"

const SATS_PER_BTC = 100_000_000

function todayIso(): string {
  return todayTransactionCalendarDay()
}

/**
 * Add a bitcoin-backed loan for the Runway borrow block. Collateral is entered
 * in BTC (converted to sats) and APR as a percent (converted to a fraction) for
 * a friendlier form; the API stores sats and a fraction.
 *
 * First screen asks only for name, cash borrowed, and due date. Lender terms
 * (rate, open date, bitcoin sent, sell price, bill style) sit behind a
 * disclosure so a quick add stays short.
 */
export function RunwayLoanDialog({
  open,
  onOpenChange,
  onSaved,
  prefill,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  /** Optional starting values when arriving from the Runway refill flow. */
  prefill?: { principalUsd?: number; collateralBtc?: number } | null
}) {
  const [label, setLabel] = useState("")
  const [principalUsd, setPrincipalUsd] = useState("")
  const [aprPercent, setAprPercent] = useState("")
  const [openedOn, setOpenedOn] = useState(todayIso)
  const [maturityOn, setMaturityOn] = useState("")
  const [collateralBtc, setCollateralBtc] = useState("")
  const [lenderSellPriceUsd, setLenderSellPriceUsd] = useState("")
  const [payoffStyle, setPayoffStyle] = useState<"accrued" | "full_bill">("full_bill")
  const [termsOpen, setTermsOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = useCallback(() => {
    setLabel("")
    setPrincipalUsd("")
    setAprPercent("")
    setOpenedOn(todayIso())
    setMaturityOn("")
    setCollateralBtc("")
    setLenderSellPriceUsd("")
    setPayoffStyle("full_bill")
    setTermsOpen(false)
    setError(null)
  }, [])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      onOpenChange(next)
      if (!next) reset()
    },
    [onOpenChange, reset],
  )

  // Apply the refill-flow prefill (sized principal + collateral) when the dialog
  // opens. Deferred out of the synchronous effect body so it doesn't trip
  // react-hooks/set-state-in-effect and lets the dialog paint first.
  const prefillPrincipal = prefill?.principalUsd
  const prefillCollateral = prefill?.collateralBtc
  useEffect(() => {
    if (!open) return
    if (prefillPrincipal == null && prefillCollateral == null) return
    const t = setTimeout(() => {
      if (prefillPrincipal != null) setPrincipalUsd(String(prefillPrincipal))
      if (prefillCollateral != null) {
        setCollateralBtc(String(prefillCollateral))
        // Prefill from refill already sized the bitcoin pledged — open terms
        // so that value is visible instead of hidden behind the disclosure.
        setTermsOpen(true)
      }
    }, 0)
    return () => clearTimeout(t)
  }, [open, prefillPrincipal, prefillCollateral])

  const submit = useCallback(async () => {
    setError(null)
    const collateralSats = Math.round((parseFloat(collateralBtc) || 0) * SATS_PER_BTC)
    const apr = (parseFloat(aprPercent) || 0) / 100
    const body = {
      label: label.trim(),
      principalUsd: parseFloat(principalUsd) || 0,
      apr,
      openedOn,
      maturityOn,
      collateralSats,
      lenderSellPriceUsd: parseFloat(lenderSellPriceUsd) || 0,
      payoffStyle,
    }
    if (!body.label) {
      setError("Give the loan a short name.")
      return
    }
    if (!(body.principalUsd > 0)) {
      setError("Enter how much cash you borrowed.")
      return
    }
    if (!maturityOn.trim()) {
      setError("Pick when the loan is due.")
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/runway/loans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not save this loan.")
        return
      }
      onSaved()
      handleOpenChange(false)
    } catch {
      setError("Network error — try again.")
    } finally {
      setSaving(false)
    }
  }, [
    collateralBtc,
    aprPercent,
    label,
    principalUsd,
    openedOn,
    maturityOn,
    lenderSellPriceUsd,
    payoffStyle,
    onSaved,
    handleOpenChange,
  ])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground max-w-[min(96vw,30rem)] max-h-[90vh] overflow-y-auto"
        onKeyDown={(e) => handleDialogEnterToPrimary(e, { disabled: saving, onPrimary: () => void submit() })}
      >
        <DialogHeader>
          <DialogTitle>Add a bitcoin-backed loan</DialogTitle>
          <DialogDescription>
            Name the loan, how much cash you got, and when it&apos;s due. Lender
            terms are optional if you want to track interest and collateral later.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 pt-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="loan-label">Name</Label>
            <Input
              id="loan-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Unchained line"
              className="bg-[#1A1A1A] border-[#333]"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="loan-principal">Cash borrowed (USD)</Label>
              <Input
                id="loan-principal"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={principalUsd}
                onChange={(e) => setPrincipalUsd(e.target.value)}
                className="bg-[#1A1A1A] border-[#333]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="loan-maturity">Due on</Label>
              <Input
                id="loan-maturity"
                type="date"
                value={maturityOn}
                onChange={(e) => setMaturityOn(e.target.value)}
                className="bg-[#1A1A1A] border-[#333]"
              />
            </div>
          </div>

          <Collapsible open={termsOpen} onOpenChange={setTermsOpen}>
            <CollapsibleTrigger
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-[#333] px-3 py-2.5 text-left text-sm hover:border-[#555]"
            >
              <span className="font-medium text-foreground">Add the lender&apos;s terms</span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${termsOpen ? "rotate-180" : ""}`}
                aria-hidden
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-3 pt-3">
              <p className="text-xs text-muted-foreground">
                Interest, bitcoin you sent, and their sell price help us show how
                close you are to a forced sale.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="loan-apr">Interest rate (% per year)</Label>
                  <Input
                    id="loan-apr"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={aprPercent}
                    onChange={(e) => setAprPercent(e.target.value)}
                    placeholder="10"
                    className="bg-[#1A1A1A] border-[#333]"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="loan-opened">Opened on</Label>
                  <Input
                    id="loan-opened"
                    type="date"
                    value={openedOn}
                    onChange={(e) => setOpenedOn(e.target.value)}
                    className="bg-[#1A1A1A] border-[#333]"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="loan-collateral">Bitcoin sent (BTC)</Label>
                  <Input
                    id="loan-collateral"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.00000001"
                    value={collateralBtc}
                    onChange={(e) => setCollateralBtc(e.target.value)}
                    placeholder="0.5"
                    className="bg-[#1A1A1A] border-[#333]"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="loan-sell">Lender&apos;s sell price (USD)</Label>
                  <Input
                    id="loan-sell"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={lenderSellPriceUsd}
                    onChange={(e) => setLenderSellPriceUsd(e.target.value)}
                    className="bg-[#1A1A1A] border-[#333]"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>How the bill builds up</Label>
                <div
                  className="grid grid-cols-1 sm:grid-cols-2 gap-2"
                  role="radiogroup"
                  aria-label="How the bill builds up"
                >
                  {(
                    [
                      {
                        v: "full_bill",
                        t: "One bill at the due date",
                        h: "Pay principal + interest when it matures",
                      },
                      {
                        v: "accrued",
                        t: "Builds up over time",
                        h: "Interest accrues as the loan runs",
                      },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      role="radio"
                      aria-checked={payoffStyle === o.v}
                      onClick={() => setPayoffStyle(o.v)}
                      className={`text-left rounded-xl border p-2.5 transition-colors ${
                        payoffStyle === o.v
                          ? "border-[#F7931A] bg-[#F7931A]/10"
                          : "border-[#333] hover:border-[#555]"
                      }`}
                    >
                      <span className="block text-sm font-medium">{o.t}</span>
                      <span className="block text-xs text-muted-foreground mt-0.5">{o.h}</span>
                    </button>
                  ))}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {error && (
            <p className="text-sm text-amber-400/95" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/90"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Add loan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
