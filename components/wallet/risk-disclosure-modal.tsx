"use client"

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog"
import { ShieldAlert } from "lucide-react"

interface RiskDisclosureModalProps {
  open: boolean
  onClose: () => void
}

export function RiskDisclosureModal({ open, onClose }: RiskDisclosureModalProps) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <AlertDialogContent className="max-w-[min(96vw,30rem)] bg-[#0D0D0D] border border-[#F7931A]/30">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-[#F7931A]">
            <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden />
            Software-Protected: What This Means
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground text-left">
              <p>
                Your device does not have a dedicated Secure Enclave or StrongBox chip available to
                this browser. Your wallet&apos;s key share is still encrypted (AES-GCM, 256-bit) but
                the encryption key lives in browser storage rather than hardware-isolated memory.
              </p>
              <p className="font-medium text-foreground">Practical implications:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Malware with full browser access could extract the key material.</li>
                <li>The passphrase option adds meaningful protection — use it.</li>
                <li>
                  For high-value amounts, use a hardware wallet (Ledger, Coldcard) and only store
                  the xpub here for transaction tracking.
                </li>
              </ul>
              <p className="font-medium text-[#F7931A]">This is a research preview.</p>
              <p>
                Do not store funds you cannot afford to lose. The MPC signing protocol that
                distributes risk across multiple share holders is not yet fully implemented.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose} className="w-full">
            I understand
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
