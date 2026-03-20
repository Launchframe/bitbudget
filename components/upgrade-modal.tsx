"use client"

import { useEffect, useRef, useState } from "react"
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

type InterestState = "idle" | "saving" | "done" | "done_already_premium" | "error"

export function UpgradeModal({ feature, open, onClose }: UpgradeModalProps) {
  const [interestState, setInterestState] = useState<InterestState>("idle")
  /** Only set when interestState is "done"; used so Nostr-only accounts aren't promised email. */
  const [recordedHasEmail, setRecordedHasEmail] = useState(false)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (interestState !== "done" && interestState !== "done_already_premium") return
    const delay = interestState === "done_already_premium" ? 2500 : 10000
    const t = window.setTimeout(() => onCloseRef.current(), delay)
    return () => clearTimeout(t)
  }, [interestState])

  if (!open) return null

  const info = featureInfo[feature]

  async function recordPremiumInterest() {
    setInterestState("saving")
    try {
      const res = await fetch("/api/user/premium-interest", { method: "POST" })
      if (!res.ok) {
        setInterestState("error")
        return
      }
      const data = (await res.json()) as { recorded?: boolean; reason?: string; hasEmail?: boolean }
      if (data.recorded === false && data.reason === "already_premium") {
        setInterestState("done_already_premium")
      } else {
        setRecordedHasEmail(data.hasEmail === true)
        setInterestState("done")
      }
    } catch {
      setInterestState("error")
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md bg-[#0D0D0D] border border-[#333] rounded-2xl p-6 mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-foreground">{info.title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {interestState === "done" ? (
          <p className="text-sm text-[#22C55E] mb-6">
            {recordedHasEmail ? (
              <>
                Thanks — we&apos;ve recorded your interest. Checkout isn&apos;t live yet; we&apos;ll email you when Premium is
                available.
              </>
            ) : (
              <>
                Thanks — we&apos;ve recorded your interest. Checkout isn&apos;t live yet. Check your Nostr DMs tomorrow for next 
                steps.
              </>
            )}
          </p>
        ) : interestState === "done_already_premium" ? (
          <p className="text-sm text-muted-foreground mb-6">You&apos;re already on Premium. You can close this dialog.</p>
        ) : (
          <>
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
          </>
        )}

        {interestState === "error" && (
          <p className="text-sm text-red-400 mb-4">
            Couldn&apos;t save right now. Check your connection and try again.
          </p>
        )}

        <div className="flex gap-3">
          {interestState === "idle" || interestState === "error" || interestState === "saving" ? (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={interestState === "saving"}
                className="flex-1 px-4 py-2.5 border border-[#333] rounded-xl text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                Not now
              </button>
              <button
                type="button"
                onClick={() => void recordPremiumInterest()}
                disabled={interestState === "saving"}
                className="flex-1 px-4 py-2.5 bg-[#F7931A] text-[#0D0D0D] rounded-xl text-sm font-semibold hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50"
              >
                {interestState === "saving" ? "Saving…" : "Upgrade to Premium"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-[#1A1A1A] border border-[#333] rounded-xl text-sm text-foreground hover:bg-[#222] transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
