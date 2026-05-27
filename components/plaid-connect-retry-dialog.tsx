"use client"

import { AlertCircle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { PLAID_CONNECT_RETRY_TITLE } from "@/lib/plaid-link-feedback"

interface PlaidConnectRetryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  message: string
  onRetry: () => void
  retrying?: boolean
}

export function PlaidConnectRetryDialog({
  open,
  onOpenChange,
  message,
  onRetry,
  retrying = false,
}: PlaidConnectRetryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(96vw,28rem)] border-[#1F1F1F] bg-[#0D0D0D] text-foreground">
        <DialogHeader className="items-center space-y-4 text-center sm:text-center">
          <AlertCircle className="h-14 w-14 text-[#F7931A]" aria-hidden />
          <DialogTitle className="text-lg font-semibold leading-snug">
            {PLAID_CONNECT_RETRY_TITLE}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{message}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            className="w-full bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/90"
            disabled={retrying}
            onClick={() => onRetry()}
          >
            {retrying ? "Opening…" : "Try again"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full text-muted-foreground hover:text-foreground"
            disabled={retrying}
            onClick={() => onOpenChange(false)}
          >
            Not now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
