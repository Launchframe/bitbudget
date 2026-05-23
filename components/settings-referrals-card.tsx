"use client"

import dynamic from "next/dynamic"
import { useCallback, useMemo, useState } from "react"
import { useApp } from "@/lib/app-context"
import { getPublicAppUrlClient } from "@/lib/public-app-url"
import { ReferralTerms } from "@/components/referral-terms"
import { Button } from "@/components/ui/button"
import { Gift, Copy, Check, Loader2, Mail, Share2 } from "lucide-react"
import {
  REFEREE_PREMIUM_CARROT_FALLBACK,
  refereePremiumExperienceCarrot,
} from "@/lib/subscription"

const QRCodeSVG = dynamic(() => import("qrcode.react").then(m => m.QRCodeSVG), { ssr: false })

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.ceil((t - Date.now()) / 86400000))
}

export function SettingsReferralsCard() {
  const {
    referralSummary,
    refreshData,
    premiumTrialUntilIso,
    premiumGratisUntilIso,
    effectiveTier,
    subscriptionTier,
    refereePendingBankLink,
    referralRefereeTrialMonths,
  } = useApp()
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const base = useMemo(() => getPublicAppUrlClient(), [])

  const activeCode = referralSummary?.code ?? null
  const expiresAt = referralSummary?.codeExpiresAt ?? null
  const last = referralSummary?.lastCode ?? null

  const showGenerate =
    !activeCode && (!last || last.usedCount >= 1 || (expiresAt && new Date(expiresAt).getTime() <= Date.now()))

  const referralUrl = useCallback(
    (method: string) =>
      activeCode ? `${base}/ref/${encodeURIComponent(activeCode)}?method=${method}` : "",
    [base, activeCode],
  )

  const handleGenerate = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const res = await fetch("/api/user/referral-code", { method: "POST" })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setErr(typeof j.error === "string" ? j.error : "Could not generate code")
        return
      }
      try {
        sessionStorage.setItem("bitbudget-survey-referrer", "1")
      } catch {
        /* ignore */
      }
      await refreshData()
    } finally {
      setLoading(false)
    }
  }, [refreshData])

  const copyLink = useCallback(async () => {
    const u = referralUrl("copy")
    if (!u) return
    try {
      await navigator.clipboard.writeText(u)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setErr("Could not copy")
    }
  }, [referralUrl])

  const emailShare = useCallback(() => {
    const u = referralUrl("email")
    if (!u) return
    const subject = encodeURIComponent("Join me on BitBudget")
    const body = encodeURIComponent(`I'm using BitBudget for budgeting — join with my link:\n\n${u}`)
    window.location.href = `mailto:?subject=${subject}&body=${body}`
  }, [referralUrl])

  const nativeShare = useCallback(async () => {
    const u = referralUrl("share")
    if (!u || !navigator.share) return
    try {
      await navigator.share({
        title: "BitBudget",
        text: "Join me on BitBudget",
        url: u,
      })
    } catch {
      /* user cancelled */
    }
  }, [referralUrl])

  const dLeft = daysUntil(expiresAt)

  return (
    <div className="p-6 bg-[#0D0D0D] rounded-2xl space-y-4 w-full">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-[#F7931A]/10">
          <Gift className="h-5 w-5 text-[#F7931A]" />
        </div>
        <h3 className="text-lg font-semibold text-foreground">Referrals</h3>
      </div>

      <ReferralTerms />

      {refereePendingBankLink && (
        <div className="rounded-xl border border-[#3B82F6]/35 bg-[#3B82F6]/10 px-4 py-3 space-y-2 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Your referral bonus</p>
          <p>
            <strong className="text-foreground">
              {referralRefereeTrialMonths === 1 || referralRefereeTrialMonths === 3
                ? refereePremiumExperienceCarrot(referralRefereeTrialMonths)
                : REFEREE_PREMIUM_CARROT_FALLBACK}
            </strong>{" "}
            Connect your bank in the <strong className="text-foreground">Connections</strong> section below to start
            your trial — no payment details required.
          </p>
          <p className="text-xs">
            Until you link a bank, Plan may show <strong className="text-foreground">Free</strong> — that&apos;s
            expected. Receipt inbox and SMS unlock when your trial starts.
          </p>
        </div>
      )}

      {premiumTrialUntilIso && effectiveTier === "premium-trial" && (
        <p className="text-sm text-[#3B82F6]">
          Premium trial active until {new Date(premiumTrialUntilIso).toLocaleDateString()}.
        </p>
      )}
      {premiumGratisUntilIso && effectiveTier === "premium" && subscriptionTier !== "premium" && (
        <p className="text-sm text-[#F7931A]">
          Referral bonus premium until {new Date(premiumGratisUntilIso).toLocaleDateString()}.
        </p>
      )}

      {err && <p className="text-sm text-red-400">{err}</p>}

      {activeCode ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#333] bg-[#1A1A1A] p-4">
            <p className="text-xs text-muted-foreground mb-1">Your code</p>
            <p className="font-mono text-lg text-[#F7931A] font-semibold tracking-wider">{activeCode}</p>
            {dLeft !== null && <p className="text-xs text-muted-foreground mt-2">Expires in {dLeft} day(s)</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="border-[#333]" onClick={() => void copyLink()}>
              {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
              Copy link
            </Button>
            <Button type="button" variant="outline" size="sm" className="border-[#333]" onClick={emailShare}>
              <Mail className="h-4 w-4 mr-1" />
              Email
            </Button>
            {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
              <Button type="button" variant="outline" size="sm" className="border-[#333]" onClick={() => void nativeShare()}>
                <Share2 className="h-4 w-4 mr-1" />
                Share
              </Button>
            )}
          </div>
          {activeCode && (
            <div className="flex justify-center p-4 bg-white rounded-xl w-fit mx-auto">
              <QRCodeSVG value={referralUrl("qr")} size={160} level="M" />
            </div>
          )}
          <p className="text-sm text-muted-foreground text-center">
            {referralSummary?.referralCount ?? 0} referrals ({referralSummary?.activatedCount ?? 0} activated)
          </p>
        </div>
      ) : showGenerate ? (
        <Button
          type="button"
          onClick={() => void handleGenerate()}
          disabled={loading}
          className="w-full bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/90"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Generate referral code"}
        </Button>
      ) : last ? (
        <div className="text-sm text-muted-foreground space-y-3">
          <p>{last.usedCount >= 1 ? "Your code was used!" : "Your last code expired."}</p>
          <Button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={loading}
            className="bg-[#F7931A] text-[#0D0D0D]"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Generate new code"}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
