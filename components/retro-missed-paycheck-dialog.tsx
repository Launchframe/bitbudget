"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { formatUsd } from "@/lib/data"
import { useApp } from "@/lib/app-context"

type StatusBody = {
  applied: boolean
  eligible: boolean
  previewGrossUsd: number
  reason: string | null
}

export function RetroMissedPaycheckDialog({
  open,
  onOpenChange,
  previewGrossUsd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  previewGrossUsd: number
}) {
  const { refreshData } = useApp()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setError(null)
      setSubmitting(false)
    }
  }, [open])

  const handleConfirm = useCallback(async () => {
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch("/api/user/retro-missed-paycheck", { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not add catch-up paycheck.")
        return
      }
      await refreshData()
      onOpenChange(false)
    } catch {
      setError("Network error — try again.")
    } finally {
      setSubmitting(false)
    }
  }, [onOpenChange, refreshData])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md transition-all duration-200 ease-out">
        <DialogHeader>
          <DialogTitle>Catch up a missed paycheck?</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            This records one paycheck you earned before BitBudget, prorated for where we are in your
            pay cycle today. The amount lands in Savings first, then splits into your spending envelopes
            using your current budget sizes.
          </p>
          <p className="text-foreground font-medium">
            Estimated catch-up: {formatUsd(previewGrossUsd, 2)}
          </p>
          <p>
            You can only do this once. To undo it later, delete the income entry from your transaction
            list (this removes the related envelope funding in one step).
          </p>
          {error ? (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Not now
          </Button>
          <Button
            type="button"
            className="bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/90"
            onClick={() => void handleConfirm()}
            disabled={submitting}
          >
            {submitting ? "Adding…" : "Add catch-up paycheck"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export async function fetchRetroMissedPaycheckStatus(): Promise<StatusBody | null> {
  try {
    const res = await fetch("/api/user/retro-missed-paycheck")
    if (!res.ok) return null
    return (await res.json()) as StatusBody
  } catch {
    return null
  }
}
