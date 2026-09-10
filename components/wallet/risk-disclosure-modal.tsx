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

/**
 * Shown when the browser reports no user-verifying platform authenticator.
 * Copy must match what the code actually does: the device share is wrapped
 * with a key derived from the passkey's PRF output, so a weaker authenticator
 * means weaker protection for that share, not for the whole wallet.
 */
export function RiskDisclosureModal({ open, onClose }: RiskDisclosureModalProps) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <AlertDialogContent className="max-w-[min(96vw,30rem)] bg-[#0D0D0D] border border-[#F7931A]/30">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-[#F7931A]">
            <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden />
            Software-protected: what this means
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground text-left">
              <p>
                This browser did not report a built-in authenticator that checks it is you (face, fingerprint, or device PIN). Your device share is still encrypted with a key that only your passkey can produce, but the passkey you used may live in software rather than in a security chip.
              </p>
              <p className="font-medium text-foreground">What that changes:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Malware with full control of this device has a better chance of using your passkey without you noticing.</li>
                <li>Your other two shares are unaffected. One share alone still cannot spend.</li>
                <li>For larger amounts, use a passkey stored in your phone or a security key, or keep savings in a hardware wallet and track it here instead.</li>
              </ul>
              <p className="font-medium text-[#F7931A]">This wallet is a test-network preview.</p>
              <p>Do not rely on it for money you cannot afford to lose until mainnet is enabled.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose} className="w-full">I understand</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
