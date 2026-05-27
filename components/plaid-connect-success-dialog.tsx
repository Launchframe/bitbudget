"use client"

import { Building2 } from "lucide-react"
import { SuccessParticles } from "@/components/success-particles"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { formatPlaidAccountLabel, plaidConnectSuccessMessage } from "@/lib/plaid-connection-labels"

export interface PlaidConnectSuccessPayload {
  institutionName: string
  accounts: { accountName: string; mask: string | null; type: string }[]
}

interface PlaidConnectSuccessDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  payload: PlaidConnectSuccessPayload | null
}

export function PlaidConnectSuccessDialog({
  open,
  onOpenChange,
  payload,
}: PlaidConnectSuccessDialogProps) {
  if (!payload) return null

  const message = plaidConnectSuccessMessage(
    payload.institutionName,
    payload.accounts.length,
  )

  return (
    <>
      {open ? <SuccessParticles opportunityCostEnabled={false} /> : null}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[min(96vw,28rem)] border-[#1F1F1F] bg-[#0D0D0D] text-foreground">
          <DialogHeader className="items-center space-y-4 text-center sm:text-center">
            <Building2
              className="h-14 w-14 text-[#F7931A] animate-[bounce_1.2s_ease-in-out_infinite]"
              style={{ transformOrigin: "center bottom" }}
              aria-hidden
            />
            <DialogTitle className="text-lg font-semibold leading-snug">{message}</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {payload.accounts.length > 0 ? (
                  <ul className="space-y-1 text-left">
                    {payload.accounts.map((account, index) => (
                      <li key={`${account.accountName}-${account.mask ?? index}`}>
                        {formatPlaidAccountLabel(account)}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p>
                  New transactions from this bank will sync automatically when your bank sends updates.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <Button
            type="button"
            className="w-full bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/90"
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
