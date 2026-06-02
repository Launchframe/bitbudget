"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { SlidersHorizontal, ArrowLeftRight, PiggyBank } from "lucide-react"
import { useApp } from "@/lib/app-context"
import { MOVE_TO_FROM_SAVINGS_TITLE } from "@/lib/constants"

export function AdjustEnvelopesDialog({
  open,
  onOpenChange,
  onMoveFunds,
  onFundFromSavings,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onMoveFunds: () => void
  onFundFromSavings: () => void
}) {
  const { navigateTo } = useApp()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Adjust envelopes</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            className="justify-start gap-2"
            onClick={() => {
              onOpenChange(false)
              navigateTo("envelope-allocations")
            }}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            Edit allocations
          </Button>
          <Button
            type="button"
            variant="outline"
            className="justify-start gap-2"
            onClick={() => {
              onOpenChange(false)
              onMoveFunds()
            }}
          >
            <ArrowLeftRight className="h-4 w-4" aria-hidden />
            Rebalance Envelopes
          </Button>
          <Button
            type="button"
            variant="outline"
            className="justify-start gap-2"
            onClick={() => {
              onOpenChange(false)
              onFundFromSavings()
            }}
          >
            <PiggyBank className="h-4 w-4" aria-hidden />
            {MOVE_TO_FROM_SAVINGS_TITLE}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
