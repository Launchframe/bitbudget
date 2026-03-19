"use client"

import { X, Shield, AlertTriangle } from "lucide-react"

export type PremiumFeature = "sms" | "email_scan" | "plaid" | "receipt_inbox"

const featureInfo: Record<PremiumFeature, { title: string; description: string; privacy: string }> = {
  receipt_inbox: {
    title: "Receipt Inbox",
    description:
      "Get a private email address to forward receipts. We parse them and queue transactions for your review — no manual entry.",
    privacy:
      "Only emails to your dedicated address are processed. Parsed receipt data is encrypted with your key before storage.",
  },
  sms: {
    title: "SMS Transaction Alerts",
    description: "Forward your bank's SMS alerts to automatically capture transactions.",
    privacy: "You'll forward SMS messages to a phone number we provide. We parse the transaction data and discard the raw message after processing.",
  },
  email_scan: {
    title: "Connected Email Scanning",
    description: "Connect your Gmail or Outlook to automatically find and import receipts.",
    privacy: "We scan your inbox for emails from known receipt senders only. We don't read other messages. You can disconnect at any time.",
  },
  plaid: {
    title: "Bank Account Sync",
    description: "Connect your bank and credit card accounts for automatic transaction import.",
    privacy: "Plaid connects to your bank using your credentials. Plaid and bitbudget will have read access to your transaction history.",
  },
}

interface UpgradeModalProps {
  feature: PremiumFeature
  open: boolean
  onClose: () => void
}

export function UpgradeModal({ feature, open, onClose }: UpgradeModalProps) {
  if (!open) return null

  const info = featureInfo[feature]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md bg-[#0D0D0D] border border-[#333] rounded-2xl p-6 mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-foreground">{info.title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground mb-4">{info.description}</p>

        <div className="flex items-start gap-3 p-3 bg-[#1A1A1A] border border-[#F7931A]/20 rounded-xl mb-6">
          <AlertTriangle className="h-5 w-5 text-[#F7931A] shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-[#F7931A] mb-1">Privacy Notice</p>
            <p className="text-xs text-muted-foreground">{info.privacy}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-3 bg-[#1A1A1A] rounded-xl mb-6">
          <Shield className="h-5 w-5 text-green-500 shrink-0" />
          <p className="text-xs text-muted-foreground">
            Your transactions are always encrypted with your personal key. We can never read your data.
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-[#333] rounded-xl text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Not now
          </button>
          <button
            onClick={() => {
              // TODO: Integrate with Stripe checkout
              window.alert("Coming soon!")
              onClose()
            }}
            className="flex-1 px-4 py-2.5 bg-[#F7931A] text-[#0D0D0D] rounded-xl text-sm font-semibold hover:bg-[#F7931A]/90 transition-colors"
          >
            Upgrade to Premium
          </button>
        </div>
      </div>
    </div>
  )
}
