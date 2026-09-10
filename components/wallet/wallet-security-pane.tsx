"use client"

import { useState } from "react"
import { Download, Fingerprint, ShieldAlert, ShieldCheck, Server } from "lucide-react"
import type { StoredWalletCustody } from "@/lib/wallet/wallet-idb"
import { SecurityStatusBadge } from "@/components/wallet/security-status-badge"
import { RiskDisclosureModal } from "@/components/wallet/risk-disclosure-modal"
import type { WorkspaceWallet } from "@/components/wallet/wallet-workspace"

/**
 * Security tab. Plain-language, honest description of the custody model:
 * this is a hot wallet whose spending needs two of three shares, BitBudget
 * runs the co-signer and can refuse (but never spend), and recovery works
 * with the file plus either other share. No marketing copy that overstates
 * what the current build can do.
 */
export function WalletSecurityPane({ wallet, record }: { wallet: WorkspaceWallet; record: StoredWalletCustody | null }) {
  const [riskOpen, setRiskOpen] = useState(false)
  const hasDeviceShare = Boolean(record?.envelopes.deviceShare)
  const recoveryVerified = Boolean(record?.recoveryVerifiedAt ?? wallet.recoveryVerifiedAt)

  const shares = [
    {
      Icon: Fingerprint,
      title: "Share A · this device",
      status: hasDeviceShare ? "Stored here, unlocked by your passkey" : "Not on this device",
      ok: hasDeviceShare,
      body: "Encrypted with a key your passkey produces at unlock time. Nothing on this device can use it without you approving with your face, fingerprint, or device PIN.",
    },
    {
      Icon: Server,
      title: "Share B · BitBudget co-signer",
      status: "Held by BitBudget",
      ok: true,
      body: "Our server signs alongside your device after you approve. It cannot spend on its own, and it never sees your other shares. It can refuse to sign, which would mean you recover with your file instead.",
    },
    {
      Icon: Download,
      title: "Share C · your recovery file",
      status: recoveryVerified ? "Downloaded and verified" : "Not verified yet",
      ok: recoveryVerified,
      body: "A file you keep, protected by the recovery password you chose. With it plus either your device or the co-signer, you can recover. Store it somewhere safe, like a password manager's secure note.",
    },
  ]

  return (
    <section className="grid gap-4" aria-label="Wallet security">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-[#0D0D0D] p-4 sm:p-6">
        <div className="min-w-0">
          <h3 className="font-semibold">How this wallet is protected</h3>
          <p className="mt-1 text-sm text-muted-foreground">Two of three shares are needed to spend. No seed phrase exists, so there is none to lose or to steal.</p>
        </div>
        <SecurityStatusBadge onRiskClick={() => setRiskOpen(true)} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {shares.map(({ Icon, title, status, ok, body }) => (
          <div key={title} className="min-w-0 rounded-2xl border border-border bg-[#0D0D0D] p-4 sm:p-5">
            <Icon className="mb-3 h-6 w-6 text-[#F7931A]" aria-hidden />
            <h4 className="font-semibold">{title}</h4>
            <p className={`mt-1 text-xs ${ok ? "text-green-400" : "text-amber-200"}`}>{status}</p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" aria-hidden />
          <div className="min-w-0 space-y-2 text-sm text-amber-100/90">
            <p className="font-semibold text-amber-200">This is a hot wallet.</p>
            <p>Your device share is used inside this browser. That is convenient for everyday spending, but it is not the same as a hardware wallet kept offline. For long-term savings you do not plan to touch, keep most of it in a hardware wallet and track it here with its public key instead.</p>
            <p>BitBudget runs the co-signer. We cannot take your bitcoin, but if our service were unavailable or refused to sign, you would need your recovery file and this device to move funds. Keep that file current.</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-[#0D0D0D] p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#F7931A]" aria-hidden />
          <div className="min-w-0 space-y-2 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground">What BitBudget can and cannot see</p>
            <p>We store your co-signer share encrypted and the public wallet details needed to co-sign. We do not learn your addresses or balances from signing alone; balances and history are read from the explorer you choose, directly from your browser.</p>
            <p>Transaction records in your budget are encrypted on your device before they are saved, like every other transaction in BitBudget.</p>
            <p>Recovery is never limited by your plan. If you stop paying for Premium, your recovery file and this device still work.</p>
          </div>
        </div>
      </div>

      <RiskDisclosureModal open={riskOpen} onClose={() => setRiskOpen(false)} />
    </section>
  )
}
