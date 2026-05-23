"use client"

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { signOut } from "next-auth/react"
import { BitbudgetLogo } from "@/components/bitbudget-logo"
import { DocumentFavicon } from "@/components/document-favicon"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Plus, Trash2, Pencil, ChevronRight, ChevronLeft, Lock, Wallet, DollarSign, PiggyBank, PieChart, Upload, X, ShieldCheck, Gift, Building2 } from "lucide-react"
import { EnvelopeAppearancePicker } from "@/components/envelope-appearance-picker"
import {
  filterSuggestions,
  pickEnvelopeIconForName,
  isLettersEnvelopeIcon,
  makeLettersEnvelopeIcon,
  initialsForEnvelopeName,
} from "@/lib/envelope-icons"
import { EnvelopeIconDisplay } from "@/components/envelope-icon-display"
import { CSVImportDialog } from "@/components/csv-import-dialog"
import { PlaidLinkButton } from "@/components/plaid-link-button"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  deriveKeyFromPin,
  generateSalt,
  generatePrivacyKey,
  encryptPrivacyKey,
  uint8ToHex,
} from "@/lib/crypto"
import { setCachedPrivacyKeyHex } from "@/lib/privacy-key-storage"
import { syncUserPublicKey } from "@/lib/sync-user-public-key"
import {
  getPendingNsec,
  clearPendingNsec,
  hasNsecOnboardingIntent,
  clearNsecOnboardingIntent,
} from "@/lib/nostr-local-signer"
import {
  monthlyBudgetForAllocation,
  snapOnboardingAllocationToStep,
} from "@/lib/onboarding-allocate-budget"
import {
  cadenceDisplayInteger,
  fromMonthly,
  monthlyFromDigitOnlyInput,
  toMonthly,
  type AllocationCadence,
} from "@/lib/allocation-cadence"
import { parseBitbudgetRefCookie } from "@/lib/bitbudget-ref-cookie"
import { ONBOARDING_SESSION_STORAGE_KEY } from "@/lib/onboarding-session"
import {
  REFEREE_PREMIUM_CARROT_FALLBACK,
  refereePremiumExperienceCarrot,
} from "@/lib/subscription"

type Step =
  | "referral"
  | "security"
  | "income"
  | "envelopes"
  | "allocations"
  | "import"
  | "complete"
  | "referral-bank"

// Opportunity cost is set from entry point (/welcome or / → vanilla off; /landing → btc on), not a separate step.
const STEPS: Step[] = ["referral", "security", "income", "envelopes", "allocations", "import", "complete"]
const ENVELOPE_COLORS = ["#F7931A", "#3B82F6", "#10B981", "#8B5CF6", "#EF4444", "#EAB308", "#EC4899", "#06B6D4"]

/** Stacked allocation bar: smooth width when envelope totals change ($50 bucket steps). */
const ALLOC_STACK_BAR_WIDTH_TRANSITION =
  "width 0.38s cubic-bezier(0.25, 0.8, 0.25, 1), min-width 0.38s cubic-bezier(0.25, 0.8, 0.25, 1)"

interface DraftEnvelope {
  /** Server id after first sync from Your Envelopes; used to update/delete on repeat continues. */
  id?: string
  name: string
  color: string
  icon: string
  monthlyAllotment: number
  allocationCadence: "weekly" | "biweekly" | "monthly"
}

function OnboardingSkipBar({
  show,
  disabled,
  onSkip,
}: {
  show: boolean
  disabled: boolean
  onSkip: () => void
}) {
  if (!show) return null
  return (
    <div className="mt-6 pt-4 border-t border-[#1F1F1F]">
      <p className="text-xs text-muted-foreground text-center mb-2">
        Already have data in BitBudget? Exit onboarding and return to your dashboard without changing settings here.
      </p>
      <button
        type="button"
        disabled={disabled}
        onClick={onSkip}
        className="w-full py-2.5 text-sm font-medium text-muted-foreground border border-[#333] rounded-xl hover:bg-[#1A1A1A] hover:text-foreground transition-colors disabled:opacity-50"
      >
        Skip onboarding — go to dashboard
      </button>
    </div>
  )
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>("referral")
  const [loading, setLoading] = useState(false)
  const [isNostr, setIsNostr] = useState(false)
  const [isNsecFallback, setIsNsecFallback] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  // Security
  const [pin, setPin] = useState("")
  const [pinConfirm, setPinConfirm] = useState("")
  const [pinError, setPinError] = useState("")

  // Income
  const [income, setIncome] = useState("")
  const [cadence, setCadence] = useState<"monthly" | "bimonthly">("monthly")

  // Envelopes
  const [envelopes, setEnvelopes] = useState<DraftEnvelope[]>(() => {
    const used = new Set<string>()
    const iconFor = (name: string) => {
      const icon = pickEnvelopeIconForName(name, used)
      used.add(icon)
      return icon
    }
    return [
      { name: "Rent", color: ENVELOPE_COLORS[0], icon: iconFor("Rent"), monthlyAllotment: 0, allocationCadence: "monthly" },
      { name: "Food", color: ENVELOPE_COLORS[2], icon: iconFor("Food"), monthlyAllotment: 0, allocationCadence: "monthly" },
      { name: "Transportation", color: ENVELOPE_COLORS[4], icon: iconFor("Transportation"), monthlyAllotment: 0, allocationCadence: "monthly" },
    ]
  })
  const [newEnvName, setNewEnvName] = useState("")
  const [showEnvSuggestions, setShowEnvSuggestions] = useState(false)
  const [expandedEnvIdx, setExpandedEnvIdx] = useState<number | null>(null)
  /** Snapshot for reverting invalid/duplicate envelope renames on blur (Your Envelopes step). */
  const envelopeNameBeforeEditRef = useRef("")
  const importFileInputRef = useRef<HTMLInputElement>(null)
  const prevStepForImportResetRef = useRef<Step | undefined>(undefined)

  // Allocations
  const [activeEnvIdx, setActiveEnvIdx] = useState<number | null>(null)
  /**
   * Slider thumb can sit between $50 ticks while $ / % show the last crossed bucket.
   * Cleared when the user edits the dollar field or cadence for that row.
   */
  const [allocSliderRawOverride, setAllocSliderRawOverride] = useState<{
    idx: number
    raw: number
  } | null>(null)
  const sliderRowRefs = useRef<(HTMLDivElement | null)[]>([])

  /** Append one draft envelope from trimmed name (shared by Add button and Continue). */
  function appendDraftEnvelope(prev: DraftEnvelope[], rawName: string): DraftEnvelope[] {
    const trimmed = rawName.trim()
    if (!trimmed) return prev
    const usedColors = new Set(prev.map(e => e.color))
    const nextColor = ENVELOPE_COLORS.find(c => !usedColors.has(c))
      ?? ENVELOPE_COLORS[prev.length % ENVELOPE_COLORS.length]
    return [
      ...prev,
      {
        name: trimmed,
        color: nextColor,
        icon: pickEnvelopeIconForName(trimmed, prev.map(e => e.icon)),
        monthlyAllotment: 0,
        allocationCadence: "monthly",
      },
    ]
  }

  /**
   * Advance to allocations. Pass `envelopeList` when the list was just computed in an async handler
   * so React state matches what was POSTed before `await` (closure may be stale otherwise).
   * Pending `monthlyAllotment` values are preserved; new envelopes already start at 0; removed
   * envelopes drop out with the rest of draft state.
   */
  function enterAllocations(envelopeList?: DraftEnvelope[]) {
    if (envelopeList) setEnvelopes(envelopeList)
    setActiveEnvIdx(null)
    setStep("allocations")
  }

  const clearOnboardingImportFileInput = useCallback(() => {
    const el = importFileInputRef.current
    if (el) el.value = ""
  }, [])

  // Import
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importResult, setImportResult] = useState<{
    imported: number
    skipped: number
    newEnvelopes: string[]
  } | null>(null)

  // Opportunity cost: /landing → btc; with a pending referral, inherit referrer (validate + redeem).
  const [onboardingSource] = useState<"btc" | "vanilla">(() => {
    try {
      const src = sessionStorage.getItem("onboardingSource")
      return src === "btc" ? "btc" : "vanilla"
    } catch { return "vanilla" }
  })

  const [hydrated, setHydrated] = useState(false)
  const [restoredSession, setRestoredSession] = useState(false)
  /** After first encryption + settings fetch (avoids flashing Secure Your Data when keys already exist). */
  const [bootstrapped, setBootstrapped] = useState(false)
  const [hasExistingEncryption, setHasExistingEncryption] = useState(false)
  /** Shown when user already has transactions — safe escape if onboardingComplete was reset by mistake. */
  const [canSkipOnboarding, setCanSkipOnboarding] = useState(false)
  const [skipOnboardingError, setSkipOnboardingError] = useState<string | null>(null)
  const [envelopeStepError, setEnvelopeStepError] = useState<string | null>(null)
  /** Server-side tx / recurring counts per envelope id — used for delete confirmation copy. */
  const [envelopeUsageById, setEnvelopeUsageById] = useState<
    Record<string, { transactionCount: number; recurringCount: number }>
  >({})
  /** True while GET /api/envelopes?usage=1 is in flight — avoids treating unknown usage as zero. */
  const [envelopeUsageLoading, setEnvelopeUsageLoading] = useState(false)
  /** False until a usage fetch attempt finishes on this visit to the envelopes step (success or failure). */
  const [envelopeUsageHydrated, setEnvelopeUsageHydrated] = useState(false)
  const [deletingEnvelopeIdx, setDeletingEnvelopeIdx] = useState<number | null>(null)
  const [pendingDeleteEnvelopeIdx, setPendingDeleteEnvelopeIdx] = useState<number | null>(null)

  /** Pending referral applied before security; redeemed after onboarding completes. */
  const [pendingReferral, setPendingReferral] = useState<{
    code: string
    shareMethod: string
    refereeTrialMonths?: 1 | 3
    referrerOpportunityCostEnabled?: boolean
  } | null>(null)

  const opportunityCostEnabled =
    pendingReferral?.code != null
      ? typeof pendingReferral.referrerOpportunityCostEnabled === "boolean"
        ? pendingReferral.referrerOpportunityCostEnabled
        : false
      : onboardingSource === "btc"
  const [refCodeInput, setRefCodeInput] = useState("")
  const [refValidating, setRefValidating] = useState(false)
  const [refError, setRefError] = useState<string | null>(null)
  const [completeReferralOpen, setCompleteReferralOpen] = useState(false)

  const refreshEnvelopeUsage = useCallback(async () => {
    setEnvelopeUsageLoading(true)
    try {
      const res = await fetch("/api/envelopes?usage=1")
      if (!res.ok) {
        // Don’t let a failed refresh leave prior counts trusted as “current”.
        setEnvelopeUsageById({})
        return
      }
      const rows = await res.json() as Array<{
        id: string
        transactionCount?: number
        recurringCount?: number
      }>
      const next: Record<string, { transactionCount: number; recurringCount: number }> = {}
      for (const r of rows) {
        if (!r.id) continue
        next[r.id] = {
          transactionCount: typeof r.transactionCount === "number" ? r.transactionCount : 0,
          recurringCount: typeof r.recurringCount === "number" ? r.recurringCount : 0,
        }
      }
      setEnvelopeUsageById(next)
    } catch {
      setEnvelopeUsageById({})
    } finally {
      setEnvelopeUsageLoading(false)
      setEnvelopeUsageHydrated(true)
    }
  }, [])

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(ONBOARDING_SESSION_STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw)
        if (saved.step && saved.step !== "referral" && saved.step !== "security") {
          const restoredStep: Step =
            saved.step === "opportunity-cost"
              ? "complete"
              : saved.step === "referral-bank"
                ? "referral-bank"
                : saved.step
          setStep(restoredStep)
          setRestoredSession(true)
        }
        if (saved.pendingReferral?.code) {
          const rm = saved.pendingReferral.refereeTrialMonths
          const roe = saved.pendingReferral.referrerOpportunityCostEnabled
          setPendingReferral({
            code: saved.pendingReferral.code,
            shareMethod: typeof saved.pendingReferral.shareMethod === "string" ? saved.pendingReferral.shareMethod : "direct",
            ...(rm === 1 || rm === 3 ? { refereeTrialMonths: rm } : {}),
            ...(typeof roe === "boolean" ? { referrerOpportunityCostEnabled: roe } : {}),
          })
        }
        if (saved.income) setIncome(saved.income)
        if (saved.cadence) setCadence(saved.cadence)
        if (saved.envelopes?.length) setEnvelopes(
          saved.envelopes.map((e: { id?: string; allocationCadence?: string; monthlyAllotment?: number }) => {
            const raw = typeof e.monthlyAllotment === "number" ? e.monthlyAllotment : 0
            return {
              ...e,
              id: typeof e.id === "string" && e.id.length > 0 ? e.id : undefined,
              allocationCadence: e.allocationCadence ?? "monthly",
              monthlyAllotment: Math.round(raw / 5) * 5,
            }
          })
        )
      }
    } catch { /* ignore corrupt data */ }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      sessionStorage.setItem(ONBOARDING_SESSION_STORAGE_KEY, JSON.stringify({
        step,
        income,
        cadence,
        envelopes,
        pendingReferral,
      }))
    } catch { /* storage full or unavailable */ }
  }, [hydrated, step, income, cadence, envelopes, pendingReferral])

  /** Clear chosen file + native input when navigating onto the import step (avoids stale File after back/forward or re-import). */
  useEffect(() => {
    const prev = prevStepForImportResetRef.current
    prevStepForImportResetRef.current = step
    if (step !== "import") return
    if (prev === "import") return
    setImportFile(null)
    clearOnboardingImportFileInput()
  }, [step, clearOnboardingImportFileInput])

  // Pending nsec lives in tab memory only; intent flag marks nsec-login users. If intent exists
  // but the key is gone (reload, new tab), or user is on security as nsec fallback without a key, sign out.
  useEffect(() => {
    if (!hydrated) return
    const pending = getPendingNsec()
    const lostKeyWithIntent = hasNsecOnboardingIntent() && pending === null
    const lostKeyOnPinStep =
      step === "security" && isNostr && isNsecFallback && pending === null
    if (lostKeyWithIntent || lostKeyOnPinStep) {
      clearNsecOnboardingIntent()
      void signOut({ callbackUrl: "/auth" })
    }
  }, [hydrated, step, isNostr, isNsecFallback])

  // useLayoutEffect: reset hydration + start fetch before paint so delete dialog never flashes the error copy on first paint.
  useLayoutEffect(() => {
    if (step !== "envelopes") {
      setEnvelopeUsageHydrated(false)
      return
    }
    setEnvelopeUsageHydrated(false)
    void refreshEnvelopeUsage()
  }, [step, refreshEnvelopeUsage])

  const tryApplyReferralFromCookie = useCallback(async (parsed: { code: string; shareMethod: string }) => {
    try {
      const r = await fetch(`/api/referral/validate?code=${encodeURIComponent(parsed.code)}`)
      if (!r.ok) return
      const j = (await r.json()) as {
        valid?: boolean
        refereeTrialMonths?: 1 | 3
        referrerOpportunityCostEnabled?: boolean
      }
      if (j.valid) {
        const refereeTrialMonths = j.refereeTrialMonths === 3 ? 3 : 1
        const referrerOpportunityCostEnabled =
          typeof j.referrerOpportunityCostEnabled === "boolean" ? j.referrerOpportunityCostEnabled : false
        setPendingReferral({
          code: parsed.code,
          shareMethod: parsed.shareMethod,
          refereeTrialMonths,
          referrerOpportunityCostEnabled,
        })
      }
    } catch {
      /* ignore */
    }
  }, [])

  /** Apply `bitbudget_ref` on any step — session restore can skip the referral step before the old referral-only effect ran. */
  useEffect(() => {
    if (!hydrated || pendingReferral?.code) return
    const parsed = parseBitbudgetRefCookie(typeof document !== "undefined" ? document.cookie : "")
    if (!parsed?.code) return
    void tryApplyReferralFromCookie(parsed)
  }, [hydrated, pendingReferral?.code, tryApplyReferralFromCookie])

  const applyReferralCodeFromInput = useCallback(async (): Promise<boolean> => {
    const code = refCodeInput.trim()
    if (!code) return false
    setRefError(null)
    setRefValidating(true)
    try {
      const r = await fetch(`/api/referral/validate?code=${encodeURIComponent(code)}`)
      const j = (await r.json()) as {
        valid?: boolean
        refereeTrialMonths?: 1 | 3
        referrerOpportunityCostEnabled?: boolean
      }
      if (!j.valid) {
        setRefError("It looks like that code is invalid, expired, or has already been used.")
        return false
      }
      const refereeTrialMonths = j.refereeTrialMonths === 3 ? 3 : 1
      const referrerOpportunityCostEnabled =
        typeof j.referrerOpportunityCostEnabled === "boolean"
          ? j.referrerOpportunityCostEnabled
          : false
      setPendingReferral({
        code,
        shareMethod: "direct",
        refereeTrialMonths,
        referrerOpportunityCostEnabled,
      })
      try {
        document.cookie = `bitbudget_ref=${encodeURIComponent(`${code}:direct`)}; path=/; max-age=${86400 * 30}`
      } catch {
        /* ignore */
      }
      setCompleteReferralOpen(false)
      return true
    } finally {
      setRefValidating(false)
    }
  }, [refCodeInput])

  /** Backfill trial length and referrer OC for older sessionStorage blobs that only stored the code. */
  useEffect(() => {
    if (!hydrated || !pendingReferral?.code) return
    const hasTrial = pendingReferral.refereeTrialMonths === 1 || pendingReferral.refereeTrialMonths === 3
    const hasOc = typeof pendingReferral.referrerOpportunityCostEnabled === "boolean"
    if (hasTrial && hasOc) return
    let cancelled = false
    void (async () => {
      try {
        const r = await fetch(`/api/referral/validate?code=${encodeURIComponent(pendingReferral.code)}`)
        if (!r.ok || cancelled) return
        const j = (await r.json()) as {
          valid?: boolean
          refereeTrialMonths?: 1 | 3
          referrerOpportunityCostEnabled?: boolean
        }
        if (!j.valid || cancelled) return
        const refereeTrialMonths = j.refereeTrialMonths === 3 ? 3 : 1
        const referrerOpportunityCostEnabled =
          typeof j.referrerOpportunityCostEnabled === "boolean" ? j.referrerOpportunityCostEnabled : false
        setPendingReferral(prev =>
          prev && prev.code === pendingReferral.code
            ? { ...prev, refereeTrialMonths, referrerOpportunityCostEnabled }
            : prev,
        )
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hydrated, pendingReferral?.code, pendingReferral?.refereeTrialMonths, pendingReferral?.referrerOpportunityCostEnabled])

  /** Extra step count for referees (avoid `document`/cookie in render — prevents SSR/client mismatch). */
  const referralBankQueued = !!pendingReferral?.code || step === "referral-bank"

  const totalOnboardingSteps = referralBankQueued ? STEPS.length + 1 : STEPS.length
  const stepIndex =
    step === "referral-bank" ? STEPS.length : STEPS.indexOf(step)
  const progress = ((stepIndex + 1) / totalOnboardingSteps) * 100

  useEffect(() => {
    if (!hydrated) return
    let cancelled = false

    async function bootstrapOnboarding() {
      try {
        const [encRes, settingsRes] = await Promise.all([
          fetch("/api/user/encryption"),
          fetch("/api/user/settings"),
        ])
        if (cancelled) return
        if (
          encRes.status === 401 ||
          encRes.status === 403 ||
          settingsRes.status === 401 ||
          settingsRes.status === 403
        ) {
          signOut({ callbackUrl: "/auth" })
          return
        }

        type EncPayload = {
          userId?: string
          encryptedPrivacyKey?: string | null
          isNostr?: boolean
          nostrPubkey?: string | null
        }
        let enc: EncPayload | null = null
        if (encRes.ok) {
          enc = (await encRes.json()) as EncPayload
        }

        let nostrLoginPubkey: string | null = null
        try { nostrLoginPubkey = sessionStorage.getItem("nostr-login") } catch { /* SSR guard */ }

        const hasPendingNsec = getPendingNsec() !== null
        if (hasPendingNsec) setIsNsecFallback(true)

        let txCount = 0
        if (settingsRes.ok) {
          const settings = (await settingsRes.json()) as { transactionCount?: unknown }
          txCount = typeof settings.transactionCount === "number" ? settings.transactionCount : 0
        }
        setCanSkipOnboarding(txCount >= 1)

        if (cancelled) return

        if (!enc) {
          if (nostrLoginPubkey) {
            enc = { isNostr: true, nostrPubkey: nostrLoginPubkey }
          } else {
            return
          }
        }

        if (!enc.isNostr && nostrLoginPubkey) {
          enc.isNostr = true
          enc.nostrPubkey = enc.nostrPubkey || nostrLoginPubkey
        }

        if (enc.userId) setUserId(enc.userId)

        let hasEnc = !!(enc.encryptedPrivacyKey && String(enc.encryptedPrivacyKey).trim().length > 0)

        if (enc.isNostr) {
          setIsNostr(true)
          // nsec-paste users still owe the PIN step to encrypt the nsec for localStorage.
          // If we ran NIP-04 here, server encryption would flip hasExistingEncryption on while
          // we remain on "security" — extension users should see the Nostr security info step, not a blank card.
          if (!hasEnc && enc.nostrPubkey && !hasPendingNsec) {
            try {
              const nostrExt = (window as unknown as {
                nostr?: {
                  getPublicKey: () => Promise<string>
                  nip04?: { encrypt: (pubkey: string, plaintext: string) => Promise<string> }
                }
              }).nostr

              if (nostrExt?.nip04) {
                const privacyKey = generatePrivacyKey()
                const encrypted = await nostrExt.nip04.encrypt(enc.nostrPubkey, uint8ToHex(privacyKey))
                const res = await fetch("/api/user/encryption", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ encryptedPrivacyKey: encrypted }),
                })
                if (res.status === 409) {
                  hasEnc = true
                } else if (res.ok) {
                  if (enc.userId) setCachedPrivacyKeyHex(enc.userId, uint8ToHex(privacyKey))
                  await syncUserPublicKey(privacyKey)
                  hasEnc = true
                }
              }
            } catch {
              // NIP-04 encrypt was rejected or unavailable (e.g. keys.band authorized
              // getPublicKey but not nip04, or user denied the prompt). User continues via the
              // Nostr security info step or passphrase flow without auto-provisioned encryption.
            }
          }
          setHasExistingEncryption(hasEnc)
        } else {
          setHasExistingEncryption(hasEnc)
          if (hasEnc) {
            setStep(prev => (prev === "security" ? "income" : prev))
          }
        }

        if (enc.isNostr) {
          const markNsecFallback = hasPendingNsec || hasNsecOnboardingIntent()
          if (markNsecFallback) {
            setIsNsecFallback(true)
          }
          // Extension Nostr users see an informational security step (not auto-skipped) so step
          // numbers stay consistent; nsec-fallback users use the passphrase UI on this step.
        }
      } catch {
        /* continue */
      } finally {
        if (!cancelled) setBootstrapped(true)
      }
    }

    void bootstrapOnboarding()
    return () => {
      cancelled = true
    }
  }, [hydrated])

  function referralPayloadForRedeem(): { code: string; shareMethod: string } | null {
    if (pendingReferral?.code) return pendingReferral
    if (typeof document === "undefined") return null
    return parseBitbudgetRefCookie(document.cookie)
  }

  function clearBitbudgetRefCookie() {
    try {
      document.cookie = "bitbudget_ref=; path=/; max-age=0"
    } catch {
      /* ignore */
    }
  }

  /** Redeem referral from state or `bitbudget_ref` cookie (covers skipped referral step). */
  async function redeemPendingReferralIfAny(): Promise<boolean> {
    const payload = referralPayloadForRedeem()
    if (!payload?.code) return false
    try {
      const res = await fetch("/api/referral/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: payload.code,
          shareMethod: payload.shareMethod,
        }),
      })
      if (res.ok) clearBitbudgetRefCookie()
      return res.ok
    } catch {
      return false
    }
  }

  function finishOnboardingExit() {
    try {
      sessionStorage.removeItem(ONBOARDING_SESSION_STORAGE_KEY)
      sessionStorage.removeItem("onboardingSource")
      sessionStorage.removeItem("nostr-login")
    } catch {
      /* ignore */
    }
    router.push("/")
    router.refresh()
  }

  async function skipOnboardingToDashboard() {
    setSkipOnboardingError(null)
    setLoading(true)
    try {
      const res = await fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboardingComplete: true, opportunityCostEnabled }),
      })
      if (res.status === 401 || res.status === 403) {
        await signOut({ callbackUrl: "/auth" })
        return
      }
      if (!res.ok) {
        setSkipOnboardingError("Could not save settings. Try again or sign out and back in.")
        return
      }
      const hadReferralCode = !!referralPayloadForRedeem()?.code
      const redeemOk = await redeemPendingReferralIfAny()
      if (hadReferralCode && redeemOk) {
        setStep("referral-bank")
        return
      }
      finishOnboardingExit()
    } finally {
      setLoading(false)
    }
  }

  async function handleSecuritySetup() {
    if (pin.length < 4) {
      setPinError("Passphrase must be at least 4 characters")
      return
    }
    if (pin !== pinConfirm) {
      setPinError("Passphrases don\u2019t match")
      return
    }
    setPinError("")
    setLoading(true)

    try {
      const salt = generateSalt()
      const derivedKey = await deriveKeyFromPin(pin, salt)
      const privacyKey = generatePrivacyKey()
      const encrypted = await encryptPrivacyKey(privacyKey, derivedKey)

      const encRes = await fetch("/api/user/encryption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encryptedPrivacyKey: JSON.stringify(encrypted),
          privacyKeySalt: uint8ToHex(salt),
        }),
      })

      if (encRes.status === 409) {
        let msg = "This account already has encryption. Open the main app and unlock with your existing passphrase."
        try {
          const errBody = await encRes.json() as { error?: string }
          if (typeof errBody.error === "string") msg = errBody.error
        } catch { /* use default */ }
        setPinError(msg)
        return
      }
      if (!encRes.ok) {
        setPinError("Failed to set up encryption. Please try again.")
        return
      }

      if (typeof window !== "undefined") {
        try {
          if (userId) setCachedPrivacyKeyHex(userId, uint8ToHex(privacyKey))
        } catch {
          /* continue; server encryption is already saved */
        }
        const pendingNsec = getPendingNsec()
        if (pendingNsec) {
          try {
            const nsecEncrypted = await encryptPrivacyKey(pendingNsec, derivedKey)
            localStorage.setItem("bitbudget-nsec", JSON.stringify(nsecEncrypted))
            if (userId) localStorage.setItem("bitbudget-nsec-user", userId)
          } catch {
            /* localStorage quota / disabled — passphrase setup still succeeded */
          }
        }
      }
      // Single cleanup after encryption setup succeeds (memory + session intent; not tied to window-only branch).
      clearNsecOnboardingIntent()
      clearPendingNsec()
      await syncUserPublicKey(privacyKey)

      setStep("income")
    } catch {
      setPinError("Failed to set up encryption. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  async function handleIncomeSave() {
    setLoading(true)
    try {
      const rawIncome = parseFloat(income) || 0
      await fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthlyIncome: monthlyBudgetForAllocation(rawIncome, cadence),
          payCadence: cadence,
        }),
      })
      setStep("envelopes")
    } finally {
      setLoading(false)
    }
  }

  function addEnvelopeWithName(name: string) {
    if (!name.trim()) return
    setEnvelopes(prev => appendDraftEnvelope(prev, name))
    setNewEnvName("")
  }

  function addEnvelope() {
    addEnvelopeWithName(newEnvName)
  }

  function removeEnvelope(idx: number) {
    setEnvelopes(prev => prev.filter((_, i) => i !== idx))
    setExpandedEnvIdx(prev => {
      if (prev === null) return null
      if (prev === idx) return null
      if (prev > idx) return prev - 1
      return prev
    })
  }

  function requestRemoveEnvelopeRow(idx: number) {
    const env = envelopes[idx]
    if (!env) return
    if (!env.id) {
      removeEnvelope(idx)
      return
    }
    setPendingDeleteEnvelopeIdx(idx)
  }

  async function confirmDeleteEnvelope() {
    const idx = pendingDeleteEnvelopeIdx
    if (idx === null) return
    const env = envelopes[idx]
    if (!env?.id) {
      setPendingDeleteEnvelopeIdx(null)
      return
    }

    setDeletingEnvelopeIdx(idx)
    setEnvelopeStepError(null)
    try {
      const res = await fetch(`/api/envelopes?id=${encodeURIComponent(env.id)}`, { method: "DELETE" })
      if (!res.ok) {
        let errMsg = "Could not remove envelope"
        try {
          const body = (await res.json()) as { error?: string }
          if (body.error) errMsg = body.error
        } catch { /* ignore */ }
        setEnvelopeStepError(errMsg)
        setPendingDeleteEnvelopeIdx(null)
        return
      }
      // Close dialog before mutating the list so `pendingDeleteEnvelopeIdx` never points at a shifted index.
      setPendingDeleteEnvelopeIdx(null)
      removeEnvelope(idx)
      setEnvelopeUsageById(prev => {
        const next = { ...prev }
        delete next[env.id!]
        return next
      })
      await refreshEnvelopeUsage()
    } finally {
      setDeletingEnvelopeIdx(null)
    }
  }

  /** @returns whether server envelopes were loaded and merged into draft state */
  async function mergeEnvelopesStateFromServer(): Promise<boolean> {
    const res = await fetch("/api/envelopes")
    if (!res.ok) return false
    let all: Array<{
      id: string
      name: string
      color: string
      icon: string | null
      monthlyAllotment: number
      archived: boolean
    }>
    try {
      const parsed: unknown = await res.json()
      if (!Array.isArray(parsed)) return false
      all = parsed as Array<{
        id: string
        name: string
        color: string
        icon: string | null
        monthlyAllotment: number
        archived: boolean
      }>
    } catch {
      return false
    }
    const active = all.filter(e => !e.archived)

    setEnvelopes(prev => {
      const seenIds = new Set<string>()
      const out: DraftEnvelope[] = []

      for (const p of prev) {
        if (!p.id) continue
        const se = active.find(e => e.id === p.id)
        if (!se) continue
        seenIds.add(se.id)
        out.push({
          id: se.id,
          name: se.name,
          color: se.color,
          icon: p.icon ?? se.icon ?? pickEnvelopeIconForName(se.name, []),
          monthlyAllotment: p.monthlyAllotment,
          allocationCadence: p.allocationCadence,
        })
      }

      for (const se of active) {
        if (seenIds.has(se.id)) continue
        out.push({
          id: se.id,
          name: se.name,
          color: se.color,
          icon: se.icon ?? pickEnvelopeIconForName(se.name, []),
          monthlyAllotment: se.monthlyAllotment ?? 0,
          allocationCadence: "monthly",
        })
      }

      return out
    })
    return true
  }

  async function handleEnvelopesSave() {
    let list = envelopes
    if (newEnvName.trim()) {
      list = appendDraftEnvelope(envelopes, newEnvName)
      setEnvelopes(list)
      setNewEnvName("")
    }
    if (list.length === 0) return
    setLoading(true)
    setEnvelopeStepError(null)
    try {
      let listForSync = list
      if (listForSync.some(e => !e.id)) {
        const res = await fetch("/api/envelopes")
        if (res.ok) {
          const server = await res.json() as Array<{ id: string; name: string }>
          const byName = new Map<string, string>()
          for (const s of server) {
            const key = s.name.toLocaleLowerCase()
            if (!byName.has(key)) byName.set(key, s.id)
          }
          listForSync = listForSync.map(d => {
            if (d.id) return d
            const matchedId = byName.get(d.name.trim().toLocaleLowerCase())
            return matchedId ? { ...d, id: matchedId } : d
          })
        }
      }

      const syncRes = await fetch("/api/envelopes/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          envelopes: listForSync.map(e => ({
            id: e.id,
            name: e.name,
            color: e.color,
            icon: e.icon,
            monthlyAllotment: e.monthlyAllotment,
          })),
        }),
      })
      if (!syncRes.ok) {
        let msg = "Could not save envelopes"
        try {
          const err = (await syncRes.json()) as { error?: string }
          if (err?.error) msg = err.error
        } catch { /* ignore */ }
        setEnvelopeStepError(msg)
        return
      }
      const data = await syncRes.json() as {
        envelopes: Array<{
          id: string
          name: string
          color: string
          icon: string | null
          monthlyAllotment: number
        }>
      }
      const merged: DraftEnvelope[] = data.envelopes.map((se, i) => ({
        id: se.id,
        name: se.name,
        color: se.color,
        icon: listForSync[i]?.icon ?? se.icon ?? pickEnvelopeIconForName(se.name, []),
        monthlyAllotment: listForSync[i]?.monthlyAllotment ?? se.monthlyAllotment,
        allocationCadence: listForSync[i]?.allocationCadence ?? "monthly",
      }))
      enterAllocations(merged)
    } finally {
      setLoading(false)
    }
  }

  async function handleAllocationsSave() {
    setLoading(true)
    try {
      for (const env of envelopes) {
        if (!env.id) continue
        await fetch("/api/envelopes", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: env.id,
            monthlyAllotment: env.monthlyAllotment,
          }),
        })
      }
      setStep(importResult !== null ? "complete" : "import")
    } finally {
      setLoading(false)
    }
  }

  function handleImport() {
    if (!importFile) {
      setStep("complete")
      return
    }
    setImportDialogOpen(true)
  }


  async function handleComplete() {
    setLoading(true)
    try {
      const res = await fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboardingComplete: true, opportunityCostEnabled }),
      })
      if (res.status === 401 || res.status === 403) {
        await signOut({ callbackUrl: "/auth" })
        return
      }
      if (!res.ok) {
        return
      }
      const hadReferralCode = !!referralPayloadForRedeem()?.code
      const redeemOk = await redeemPendingReferralIfAny()
      if (hadReferralCode && redeemOk) {
        setStep("referral-bank")
        return
      }
      finishOnboardingExit()
    } finally {
      setLoading(false)
    }
  }

  const totalAllocated = envelopes.reduce((s, e) => s + e.monthlyAllotment, 0)
  const allocateMonthlyBudget = monthlyBudgetForAllocation(parseFloat(income) || 0, cadence)
  const savings = Math.max(0, allocateMonthlyBudget - totalAllocated)
  const savingsPct =
    allocateMonthlyBudget > 0 ? Math.round((savings / allocateMonthlyBudget) * 100) : 0

  const pendingDeleteEnv =
    pendingDeleteEnvelopeIdx !== null ? envelopes[pendingDeleteEnvelopeIdx] : undefined
  const pendingDeleteEnvId = pendingDeleteEnv?.id
  const pendingDeleteUsage =
    pendingDeleteEnvId != null ? envelopeUsageById[pendingDeleteEnvId] : undefined
  const pendingDeleteUsageReady =
    pendingDeleteEnvId != null &&
    envelopeUsageHydrated &&
    !envelopeUsageLoading &&
    Object.prototype.hasOwnProperty.call(envelopeUsageById, pendingDeleteEnvId)
  const pendingDeleteTxs = pendingDeleteUsageReady ? (pendingDeleteUsage?.transactionCount ?? 0) : 0
  const pendingDeleteRec = pendingDeleteUsageReady ? (pendingDeleteUsage?.recurringCount ?? 0) : 0

  /**
   * Align committed allotment with the nearest $50 bucket for the current thumb position.
   * Usually a no-op during drag (bucket updates on midpoint crossings); used on release/blur to clamp.
   */
  const commitOnboardingSliderSnap = useCallback(
    (rowIdx: number, input: HTMLInputElement) => {
      const raw = parseInt(input.value, 10)
      const v = Number.isFinite(raw) ? raw : 0
      setEnvelopes(prev => {
        const maxForRow =
          allocateMonthlyBudget -
          prev.reduce((s, x, j) => s + (j === rowIdx ? 0 : x.monthlyAllotment), 0)
        const snapped = snapOnboardingAllocationToStep(v, maxForRow)
        return prev.map((en, i) => (i === rowIdx ? { ...en, monthlyAllotment: snapped } : en))
      })
    },
    [allocateMonthlyBudget],
  )

  const refereeTrialExplainerOnComplete =
    step === "complete" &&
    !!(pendingReferral?.code || (typeof document !== "undefined" && parseBitbudgetRefCookie(document.cookie)?.code))

  return (
    <div className="min-h-screen bg-background flex flex-col items-center p-6">
      <DocumentFavicon href={opportunityCostEnabled ? "/icon.svg" : "/icon-vanilla.svg"} />
      <div className="w-full max-w-lg flex flex-col gap-6 pt-8">
        <div className="flex items-center justify-between">
          <BitbudgetLogo variant={opportunityCostEnabled ? "btc" : "vanilla"} />
          <span className="text-xs text-muted-foreground">
            Step {stepIndex + 1} of {totalOnboardingSteps}
          </span>
        </div>

        <Progress value={progress} className="h-1.5" />

        {skipOnboardingError && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {skipOnboardingError}
          </div>
        )}

        <div className="bg-[#0D0D0D] rounded-2xl p-8">
          {restoredSession && !isNostr && step !== "referral" && step !== "security" && step !== "complete" && step !== "referral-bank" && (
            <div className="flex items-start gap-3 p-3 rounded-xl bg-[#3B82F6]/10 border border-[#3B82F6]/20 mb-6">
              <ShieldCheck className="h-5 w-5 text-[#3B82F6] shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                <p className="text-sm text-[#93C5FD] leading-snug">
                  Your progress was restored.
                  {hasExistingEncryption && bootstrapped
                    ? " Your account already has encryption — use Skip onboarding to return to the app and unlock with your existing passphrase."
                    : " Don\u2019t remember your passphrase?"}
                </p>
                {bootstrapped && !hasExistingEncryption && (
                  <button
                    type="button"
                    onClick={() => { setRestoredSession(false); setStep("security") }}
                    className="self-start text-xs font-medium text-[#3B82F6] hover:text-[#60A5FA] underline underline-offset-2 transition-colors"
                  >
                    Set a new passphrase
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setRestoredSession(false)}
                className="text-[#3B82F6]/60 hover:text-[#3B82F6] transition-colors shrink-0"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Referral / offer code (optional) */}
          {step === "referral" && (
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-[#F7931A]/10">
                  <Gift className="h-6 w-6 text-[#F7931A]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Have a referral code?</h2>
                  <p className="text-sm text-muted-foreground">
                    {pendingReferral?.refereeTrialMonths === 3
                      ? "Optional — connect your bank after signup for 3 months of premium. No payment details required."
                      : pendingReferral?.refereeTrialMonths === 1
                        ? "Optional — connect your bank after signup for 1 month of premium. No payment details required."
                        : "Optional — connect your bank after signup for premium. No payment details required."}
                  </p>
                </div>
              </div>
              {pendingReferral ? (
                <div className="rounded-xl border border-[#22C55E]/30 bg-[#22C55E]/10 px-4 py-3 text-sm text-[#86EFAC]">
                  Referral code applied: <span className="font-mono font-semibold">{pendingReferral.code}</span>
                  <button
                    type="button"
                    className="ml-2 text-xs underline text-[#BBF7D0]"
                    onClick={() => {
                      setPendingReferral(null)
                      setRefCodeInput("")
                      try {
                        document.cookie = "bitbudget_ref=; path=/; max-age=0"
                      } catch {
                        /* ignore */
                      }
                    }}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <Label className="text-muted-foreground text-xs uppercase tracking-wider">Code</Label>
                  <div className="flex gap-2">
                    <Input
                      value={refCodeInput}
                      onChange={e => setRefCodeInput(e.target.value)}
                      placeholder="Enter code"
                      className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555] flex-1"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={refValidating || !refCodeInput.trim()}
                      className="shrink-0 border-[#333] bg-[#1A1A1A]"
                      onClick={() => {
                        void applyReferralCodeFromInput()
                      }}
                    >
                      {refValidating ? "…" : "Apply"}
                    </Button>
                  </div>
                  {refError && <p className="text-sm text-red-400">{refError}</p>}
                </div>
              )}
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => setStep("security")}
                  className="w-full py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors flex items-center justify-center gap-2"
                >
                  Continue
                  <ChevronRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingReferral(null)
                    setRefCodeInput("")
                    setStep("security")
                  }}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors text-center"
                >
                  Skip
                </button>
              </div>
            </div>
          )}

          {/* Security Step: Nostr extension — informational (no passphrase on this account) */}
          {step === "security" && isNostr && !isNsecFallback && getPendingNsec() === null && (
            !bootstrapped ? (
              <div className="flex flex-col items-center justify-center gap-4 py-16">
                <Spinner className="h-8 w-8 text-btc-orange" />
                <p className="text-sm text-muted-foreground text-center">Checking your account…</p>
                <button
                  type="button"
                  onClick={() => setStep("referral")}
                  className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                >
                  <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
                  Back
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-btc-orange/10">
                    <ShieldCheck className="h-6 w-6 text-btc-orange" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-foreground">Your data is secure</h2>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  BitBudget uses your Nostr identity to encrypt your data end-to-end. Your private key never leaves your Nostr extension.
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setStep("referral")}
                    className="flex-1 py-3 bg-[#1A1A1A] text-foreground rounded-xl font-semibold text-sm hover:bg-[#222] transition-colors border border-[#333] flex items-center justify-center gap-2"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep("income")}
                    className="flex-1 py-3 bg-btc-orange text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-btc-orange/90 transition-colors flex items-center justify-center gap-2"
                  >
                    Continue
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                <OnboardingSkipBar
                  show={canSkipOnboarding}
                  disabled={loading}
                  onSkip={skipOnboardingToDashboard}
                />
              </div>
            )
          )}

          {/* Security Step: Web 2.0 users and nsec fallback users (Nostr without extension) */}
          {step === "security" && (!isNostr || isNsecFallback) && (
            !bootstrapped ? (
              <div className="flex flex-col items-center justify-center gap-4 py-16">
                <Spinner className="h-8 w-8 text-[#F7931A]" />
                <p className="text-sm text-muted-foreground text-center">Checking your account…</p>
                <button
                  type="button"
                  onClick={() => setStep("referral")}
                  className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                >
                  <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
                  Back
                </button>
              </div>
            ) : !hasExistingEncryption || getPendingNsec() !== null ? (
              <form onSubmit={e => { e.preventDefault(); handleSecuritySetup() }} className="flex flex-col gap-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-[#F7931A]/10">
                    <Lock className="h-6 w-6 text-[#F7931A]" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-foreground">Secure Your Data</h2>
                    <p className="text-sm text-muted-foreground">Create a passphrase to encrypt your private data</p>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground leading-relaxed">
                  Your transaction details (payees &amp; descriptions) are encrypted before leaving your device.
                  This passphrase derives the encryption key. <strong>If you lose it, your data cannot be recovered.</strong>
                </p>

                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <Label className="text-muted-foreground text-xs uppercase tracking-wider">Passphrase</Label>
                    <Input
                      type="password"
                      value={pin}
                      onChange={e => setPin(e.target.value)}
                      placeholder="At least 4 characters"
                      className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555]"
                      minLength={4}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label className="text-muted-foreground text-xs uppercase tracking-wider">Confirm passphrase</Label>
                    <Input
                      type="password"
                      value={pinConfirm}
                      onChange={e => setPinConfirm(e.target.value)}
                      placeholder="Re-enter your passphrase"
                      className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555]"
                    />
                  </div>
                  {pinError && <p className="text-sm text-red-400">{pinError}</p>}
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setStep("referral")}
                    className="flex-1 py-3 bg-[#1A1A1A] text-foreground rounded-xl font-semibold text-sm hover:bg-[#222] transition-colors border border-[#333] flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={loading || !pin || !pinConfirm}
                    className="flex-1 py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {loading ? "Setting up..." : "Continue"}
                    {!loading && <ChevronRight className="h-4 w-4" aria-hidden />}
                  </button>
                </div>
                <OnboardingSkipBar
                  show={canSkipOnboarding}
                  disabled={loading}
                  onSkip={skipOnboardingToDashboard}
                />
              </form>
            ) : null
          )}

          {/* Income Step */}
          {step === "income" && (
            <form onSubmit={e => { e.preventDefault(); if (income) handleIncomeSave() }} className="flex flex-col gap-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-[#22C55E]/10">
                  <DollarSign className="h-6 w-6 text-[#22C55E]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Your income</h2>
                  <p className="text-sm text-muted-foreground">How much do you take home after taxes?</p>
                </div>
              </div>

              <p className="text-sm text-muted-foreground leading-relaxed">
                {"Can be an exact amount or an estimate. You can always adjust this later."}
              </p>

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label className="text-muted-foreground text-xs uppercase tracking-wider">Regular Income (USD)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      type="number"
                      value={income}
                      onChange={e => setIncome(e.target.value)}
                      placeholder="5,000"
                      className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555] pl-7 text-lg"
                      min="0"
                      step="any"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label className="text-muted-foreground text-xs uppercase tracking-wider">Pay Frequency</Label>
                  <div className="flex rounded-lg bg-[#1A1A1A] p-1">
                    <button
                      type="button"
                      onClick={() => setCadence("monthly")}
                      className={`flex-1 py-2.5 text-sm font-medium rounded-md transition-colors ${
                        cadence === "monthly"
                          ? "bg-[#F7931A] text-[#0D0D0D]"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Monthly
                    </button>
                    <button
                      type="button"
                      onClick={() => setCadence("bimonthly")}
                      className={`flex-1 py-2.5 text-sm font-medium rounded-md transition-colors ${
                        cadence === "bimonthly"
                          ? "bg-[#F7931A] text-[#0D0D0D]"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Bi-Monthly
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setStep("security")}
                  className="flex-1 py-3 bg-[#1A1A1A] text-foreground rounded-xl font-semibold text-sm hover:bg-[#222] transition-colors border border-[#333] flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                  Back
                </button>
                <button
                  type="submit"
                  disabled={loading || !income}
                  className="flex-1 py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? "Saving..." : "Continue"}
                  {!loading && <ChevronRight className="h-4 w-4" aria-hidden />}
                </button>
              </div>
              <OnboardingSkipBar
                show={canSkipOnboarding && bootstrapped}
                disabled={loading}
                onSkip={skipOnboardingToDashboard}
              />
            </form>
          )}

          {/* Envelopes Step */}
          {step === "envelopes" && (
            <form
              onSubmit={e => {
                e.preventDefault()
                if (envelopes.length > 0 || newEnvName.trim()) handleEnvelopesSave()
              }}
              className="flex flex-col gap-6"
            >
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-[#8B5CF6]/10">
                  <Wallet className="h-6 w-6 text-[#8B5CF6]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Your envelopes</h2>
                  <p className="text-sm text-muted-foreground">Create your spending categories — you&apos;ll set budget amounts in the next step</p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                Add envelopes for each area you spend money on. Don&apos;t worry about amounts yet — the next step lets you allocate your income across these envelopes. Anything you don&apos;t allocate automatically goes into <span className="text-[#22C55E] font-medium">Savings</span>.
              </p>

              <div className="flex flex-col gap-2">
                {envelopes.map((env, idx) => {
                  const isExpanded = expandedEnvIdx === idx
                  return (
                    <div key={idx} className="flex flex-col bg-[#1A1A1A] rounded-xl overflow-hidden">
                      <div className="flex items-center gap-3 p-3">
                        <button
                          type="button"
                          onClick={() => setExpandedEnvIdx(isExpanded ? null : idx)}
                          className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:opacity-80"
                          style={{ backgroundColor: `${env.color}22` }}
                          title="Customize appearance"
                        >
                          <EnvelopeIconDisplay
                            icon={env.icon}
                            fallbackName={env.name}
                            className="h-4 w-4 text-[10px]"
                            style={{ color: env.color }}
                          />
                        </button>
                        <Input
                          value={env.name}
                          onChange={ev =>
                            setEnvelopes(prev =>
                              prev.map((row, i) => {
                                if (i !== idx) return row
                                const nextName = ev.target.value
                                let icon = row.icon
                                if (isLettersEnvelopeIcon(row.icon)) {
                                  icon = makeLettersEnvelopeIcon(initialsForEnvelopeName(nextName))
                                }
                                return { ...row, name: nextName, icon }
                              }),
                            )
                          }
                          onFocus={() => { envelopeNameBeforeEditRef.current = env.name }}
                          onBlur={() => {
                            setEnvelopes(prev =>
                              prev.map((e, i) => {
                                if (i !== idx) return e
                                const revertedName = envelopeNameBeforeEditRef.current
                                const t = e.name.trim()
                                const duplicate = prev.some(
                                  (o, j) => j !== idx && o.name.toLowerCase() === t.toLowerCase(),
                                )
                                if (!t || duplicate) {
                                  return {
                                    ...e,
                                    name: revertedName,
                                    icon: isLettersEnvelopeIcon(e.icon)
                                      ? makeLettersEnvelopeIcon(initialsForEnvelopeName(revertedName))
                                      : e.icon,
                                  }
                                }
                                let icon = e.icon
                                if (isLettersEnvelopeIcon(e.icon)) {
                                  icon = makeLettersEnvelopeIcon(initialsForEnvelopeName(t))
                                }
                                return { ...e, name: t, icon }
                              }),
                            )
                          }}
                          onKeyDown={e => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                          }}
                          aria-label={`Envelope name, ${env.name}`}
                          className="flex-1 min-w-0 bg-transparent border border-transparent hover:border-[#333] focus-visible:border-[#F7931A] rounded-md px-2 py-1.5 text-sm font-medium text-foreground h-auto shadow-none"
                        />
                        <button
                          type="button"
                          onClick={() => setExpandedEnvIdx(isExpanded ? null : idx)}
                          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                          title="Edit appearance"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={deletingEnvelopeIdx !== null}
                          onClick={() => requestRemoveEnvelopeRow(idx)}
                          className="p-1 text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
                          aria-label={`Remove ${env.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-[#2A2A2A] px-3 pb-3 pt-3">
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Appearance</span>
                            <button
                              type="button"
                              onClick={() => setExpandedEnvIdx(null)}
                              className="text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <EnvelopeAppearancePicker
                            color={env.color}
                            icon={env.icon}
                            existingEnvelopes={envelopes.map((e, i) => ({
                              id: e.id ?? `local-${i}`,
                              name: e.name,
                              icon: e.icon,
                            }))}
                            editingId={env.id ?? `local-${idx}`}
                            onColorChange={color => setEnvelopes(prev => prev.map((e, i) => i === idx ? { ...e, color } : e))}
                            onIconChange={icon => setEnvelopes(prev => prev.map((e, i) => i === idx ? { ...e, icon } : e))}
                            onReassignIcon={fromId => {
                              setEnvelopes(prev =>
                                prev.map((e, i) => {
                                  if ((e.id ?? `local-${i}`) !== fromId) return e
                                  return {
                                    ...e,
                                    icon: makeLettersEnvelopeIcon(initialsForEnvelopeName(e.name)),
                                  }
                                }),
                              )
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="relative flex gap-2">
                <div className="relative flex-1">
                  <Input
                    value={newEnvName}
                    onChange={e => { setNewEnvName(e.target.value); setShowEnvSuggestions(true) }}
                    onFocus={() => setShowEnvSuggestions(true)}
                    onKeyDown={e => {
                      if (e.key === "Enter") { e.preventDefault(); addEnvelope(); setShowEnvSuggestions(false) }
                      if (e.key === "Escape") setShowEnvSuggestions(false)
                    }}
                    onBlur={() => setTimeout(() => setShowEnvSuggestions(false), 150)}
                    placeholder="Add new envelope..."
                    className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555]"
                    autoComplete="off"
                  />
                  {showEnvSuggestions && (() => {
                    const existingNames = new Set(envelopes.map(e => e.name.toLowerCase()))
                    const filtered = filterSuggestions(newEnvName, existingNames)
                    if (filtered.length === 0) return null
                    const usedIcons = new Set(
                      envelopes.map(e => e.icon).filter((x): x is string => !!x),
                    )
                    return (
                      <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-[#1A1A1A] border border-[#333] rounded-lg max-h-48 overflow-y-auto shadow-xl">
                        {filtered.map(name => (
                            <button
                              key={name}
                              type="button"
                              onMouseDown={e => e.preventDefault()}
                              onClick={() => {
                                setNewEnvName(name)
                                setShowEnvSuggestions(false)
                                setTimeout(() => addEnvelopeWithName(name), 0)
                              }}
                              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-foreground hover:bg-[#252525] transition-colors text-left"
                            >
                              <EnvelopeIconDisplay
                                icon={pickEnvelopeIconForName(name, usedIcons)}
                                fallbackName={name}
                                className="h-3.5 w-3.5 text-[9px] text-muted-foreground shrink-0"
                              />
                              {name}
                            </button>
                          ))}
                      </div>
                    )
                  })()}
                </div>
                <button
                  type="button"
                  onClick={() => { addEnvelope(); setShowEnvSuggestions(false) }}
                  disabled={!newEnvName.trim()}
                  className="px-4 py-2 bg-[#1A1A1A] border border-[#333] text-foreground rounded-lg hover:bg-[#222] transition-colors disabled:opacity-30"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              {envelopeStepError && (
                <p className="text-sm text-red-400 text-center" role="alert">
                  {envelopeStepError}
                </p>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setEnvelopeStepError(null); setStep("income") }}
                  className="flex-1 py-3 bg-[#1A1A1A] text-foreground rounded-xl font-semibold text-sm hover:bg-[#222] transition-colors border border-[#333] flex items-center justify-center gap-2"
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </button>
                <button
                  type="submit"
                  disabled={loading || (envelopes.length === 0 && !newEnvName.trim())}
                  className="flex-1 py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? "Saving..." : "Continue"}
                  {!loading && <ChevronRight className="h-4 w-4" />}
                </button>
              </div>
              <OnboardingSkipBar
                show={canSkipOnboarding && bootstrapped}
                disabled={loading}
                onSkip={skipOnboardingToDashboard}
              />
            </form>
          )}

          {/* Allocations Step */}
          {step === "allocations" && (
            <form onSubmit={e => { e.preventDefault(); handleAllocationsSave() }} className="flex flex-col gap-6">
              <style>{`
                input[type="range"].alloc-slider {
                  -webkit-appearance: none;
                  appearance: none;
                  width: 100%;
                  height: 6px;
                  border-radius: 3px;
                  outline: none;
                  cursor: pointer;
                  touch-action: none;
                }
                input[type="range"].alloc-slider::-webkit-slider-thumb {
                  -webkit-appearance: none;
                  appearance: none;
                  width: 22px;
                  height: 22px;
                  border-radius: 50%;
                  background: var(--slider-color);
                  border: 3px solid #0D0D0D;
                  box-shadow: 0 0 0 2px var(--slider-color);
                  cursor: grab;
                  margin-top: -8px;
                  transition: transform 0.2s cubic-bezier(0.25, 0.8, 0.25, 1),
                    box-shadow 0.2s ease;
                }
                input[type="range"].alloc-slider::-webkit-slider-thumb:active {
                  cursor: grabbing;
                  transform: scale(1.12);
                }
                input[type="range"].alloc-slider::-moz-range-thumb {
                  width: 22px;
                  height: 22px;
                  border-radius: 50%;
                  background: var(--slider-color);
                  border: 3px solid #0D0D0D;
                  box-shadow: 0 0 0 2px var(--slider-color);
                  cursor: grab;
                  transition: transform 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
                }
                input[type="range"].alloc-slider::-moz-range-thumb:active {
                  cursor: grabbing;
                  transform: scale(1.12);
                }
                input[type="range"].alloc-slider::-webkit-slider-runnable-track {
                  height: 6px;
                  border-radius: 3px;
                  background: linear-gradient(
                    to right,
                    var(--slider-color) 0%,
                    var(--slider-color) var(--slider-pct),
                    #1F1F1F var(--slider-pct),
                    #1F1F1F 100%
                  );
                }
                input[type="range"].alloc-slider::-moz-range-track {
                  height: 6px;
                  border-radius: 3px;
                  background: #1F1F1F;
                }
                input[type="range"].alloc-slider::-moz-range-progress {
                  height: 6px;
                  border-radius: 3px;
                  background: var(--slider-color);
                }
              `}</style>

              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-[#3B82F6]/10">
                  <PieChart className="h-6 w-6 text-[#3B82F6]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Your budget</h2>
                  <p className="text-sm text-muted-foreground">
                    How do you use your{" "}
                    <span className="text-foreground font-medium">
                      ${allocateMonthlyBudget.toLocaleString()}
                    </span>{" "}
                    of income each month? 
                  </p>
                  <p className="text-sm text-muted-foreground">
                    You can always adjust this later.
                  </p>
                </div>
              </div>

              {/* Stacked bar — sticky while scrolling envelope sliders */}
              {allocateMonthlyBudget > 0 && (
                <div
                  className="sticky top-0 z-20 -mx-8 px-8 py-3 -mt-2 mb-2 bg-[#0D0D0D] border-b border-[#1F1F1F] shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
                >
                  <div className="flex flex-col gap-2">
                  <div className="flex h-10 w-full flex-row rounded-xl overflow-hidden bg-[#1A1A1A]">
                    {envelopes.map((env, idx) => {
                      if (env.monthlyAllotment <= 0) return null
                      const pct = (env.monthlyAllotment / allocateMonthlyBudget) * 100
                      const amt = Math.round(env.monthlyAllotment)
                      return (
                        <Tooltip key={idx} delayDuration={200}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveEnvIdx(idx)
                                sliderRowRefs.current[idx]?.scrollIntoView({ behavior: "smooth", block: "center" })
                              }}
                              className={`flex min-w-0 shrink-0 items-center justify-center relative box-border ${
                                activeEnvIdx === idx ? "brightness-110" : "hover:brightness-110"
                              }`}
                              style={{
                                width: `${pct}%`,
                                minWidth: 4,
                                backgroundColor: env.color,
                                transition: ALLOC_STACK_BAR_WIDTH_TRANSITION,
                              }}
                              aria-label={`${env.name}, $${amt.toLocaleString()} per month allocated`}
                            >
                              {pct > 8 && (
                                <EnvelopeIconDisplay
                                  icon={env.icon}
                                  fallbackName={env.name}
                                  className="h-4 w-4 text-[10px] text-[#0D0D0D]/70"
                                />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent
                            side="top"
                            sideOffset={6}
                            className="max-w-[min(100vw-2rem,16rem)] border border-[#333] bg-[#1A1A1A] px-3 py-2 text-foreground shadow-xl [&>svg]:hidden"
                          >
                            <p className="text-sm font-semibold leading-tight">{env.name}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              ${amt.toLocaleString()}/mo allocated
                              <span className="text-muted-foreground/80"> · {Math.round(pct)}%</span>
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      )
                    })}
                    {savings > 0 && (
                      <Tooltip delayDuration={200}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="flex min-w-0 shrink-0 items-center justify-center cursor-default box-border"
                            style={{
                              width: `${(savings / allocateMonthlyBudget) * 100}%`,
                              minWidth: 4,
                              backgroundColor: "rgba(34, 197, 94, 0.25)",
                              transition: ALLOC_STACK_BAR_WIDTH_TRANSITION,
                            }}
                            aria-label={`Savings, $${Math.round(savings).toLocaleString()} per month, ${savingsPct}% of budget`}
                          >
                            {savingsPct > 8 && <PiggyBank className="h-4 w-4 text-[#22C55E]/60" />}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          sideOffset={6}
                          className="max-w-[min(100vw-2rem,16rem)] border border-[#333] bg-[#1A1A1A] px-3 py-2 text-foreground shadow-xl [&>svg]:hidden"
                        >
                          <p className="text-sm font-semibold leading-tight">Savings</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            ${Math.round(savings).toLocaleString()}/mo unallocated
                            <span className="text-muted-foreground/80"> · {savingsPct}%</span>
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground px-1 transition-[color] duration-300">
                    <span className="tabular-nums">
                      ${totalAllocated.toLocaleString()} allocated
                    </span>
                    <span className="tabular-nums">${allocateMonthlyBudget.toLocaleString()} monthly budget</span>
                  </div>
                  </div>
                </div>
              )}

              {/* Per-envelope slider rows */}
              <div className="flex flex-col gap-4">
                {envelopes.map((env, idx) => {
                  const sliderMax = env.monthlyAllotment + savings
                  const pct =
                    allocateMonthlyBudget > 0
                      ? Math.round((env.monthlyAllotment / allocateMonthlyBudget) * 100)
                      : 0
                  const sliderValueClamped =
                    sliderMax <= 0
                      ? 0
                      : allocSliderRawOverride?.idx === idx
                        ? Math.min(
                            sliderMax,
                            Math.max(0, Math.round(allocSliderRawOverride.raw)),
                          )
                        : Math.min(sliderMax, Math.max(0, Math.round(env.monthlyAllotment)))
                  const sliderPct = sliderMax > 0 ? (sliderValueClamped / sliderMax) * 100 : 0

                  return (
                    <div
                      key={idx}
                      ref={el => { sliderRowRefs.current[idx] = el }}
                      className={`flex flex-col gap-2 p-3 rounded-xl transition-colors ${
                        activeEnvIdx === idx ? "bg-[#1A1A1A]" : "bg-transparent"
                      }`}
                      onClick={() => setActiveEnvIdx(idx)}
                    >
                      {/* Narrow screens: title row so name isn&apos;t squeezed out by amount controls */}
                      <p className="sm:hidden text-xs font-semibold text-foreground leading-snug truncate">
                        {env.name}
                      </p>
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                          style={{ backgroundColor: `${env.color}22` }}
                        >
                          <EnvelopeIconDisplay
                            icon={env.icon}
                            fallbackName={env.name}
                            className="h-4 w-4 text-[10px]"
                            style={{ color: env.color }}
                          />
                        </div>
                        <span className="hidden sm:block flex-1 text-sm font-medium text-foreground truncate">
                          {env.name}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0 sm:ml-0 ml-auto">
                          <span className="text-xs text-muted-foreground">$</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            value={cadenceDisplayInteger(
                              env.monthlyAllotment,
                              env.allocationCadence ?? "monthly",
                            )}
                            onChange={e => {
                              setAllocSliderRawOverride(prev =>
                                prev?.idx === idx ? null : prev,
                              )
                              const cadence = (env.allocationCadence ?? "monthly") as AllocationCadence
                              const monthly = monthlyFromDigitOnlyInput(e.target.value, cadence, sliderMax)
                              setEnvelopes(prev => prev.map((en, i) =>
                                i === idx ? { ...en, monthlyAllotment: monthly } : en,
                              ))
                            }}
                            placeholder="0"
                            className="w-20 bg-transparent border-b border-[#333] text-right text-foreground text-sm font-semibold py-0.5 focus:outline-none focus:border-[#F7931A] transition-colors"
                          />
                          <select
                            value={env.allocationCadence ?? "monthly"}
                            onChange={e => {
                              const newCadence = e.target.value as "weekly" | "biweekly" | "monthly"
                              setAllocSliderRawOverride(prev =>
                                prev?.idx === idx ? null : prev,
                              )
                              setEnvelopes(prev => prev.map((en, i) => {
                                if (i !== idx) return en
                                const oldCadence = en.allocationCadence ?? "monthly"
                                // Keep the dollar amount in the text field; re-derive monthly from that figure + new cadence.
                                const displayAmount = fromMonthly(en.monthlyAllotment, oldCadence)
                                let newMonthly = toMonthly(displayAmount, newCadence)
                                const rowTotal = prev.reduce((s, x) => s + x.monthlyAllotment, 0)
                                const otherAllocated = rowTotal - en.monthlyAllotment
                                const maxMonthly = Math.max(0, allocateMonthlyBudget - otherAllocated)
                                newMonthly = Math.round(
                                  Math.min(maxMonthly, Math.max(0, newMonthly)),
                                )
                                return {
                                  ...en,
                                  allocationCadence: newCadence,
                                  monthlyAllotment: newMonthly,
                                }
                              }))
                            }}
                            className="bg-[#1A1A1A] border border-[#333] rounded-md text-xs text-muted-foreground px-1.5 py-1 focus:outline-none focus:border-[#F7931A]"
                          >
                            <option value="weekly">/wk</option>
                            <option value="biweekly">/2wk</option>
                            <option value="monthly">/mo</option>
                          </select>
                          <span className="text-xs text-muted-foreground w-10 text-right">{pct}%</span>
                        </div>
                      </div>

                      <input
                        type="range"
                        className="alloc-slider"
                        min={0}
                        max={Math.max(0, sliderMax)}
                        step={1}
                        value={sliderValueClamped}
                        aria-label={`${env.name} monthly allotment`}
                        onChange={e => {
                          const rawParsed = parseInt(e.target.value, 10)
                          const val = Number.isFinite(rawParsed)
                            ? Math.min(sliderMax, Math.max(0, rawParsed))
                            : 0
                          setAllocSliderRawOverride({ idx, raw: val })
                          const newBucket = snapOnboardingAllocationToStep(val, sliderMax)
                          if (newBucket !== env.monthlyAllotment) {
                            setEnvelopes(prev => prev.map((en, i) =>
                              i === idx ? { ...en, monthlyAllotment: newBucket } : en,
                            ))
                          }
                        }}
                        onPointerDown={e => {
                          const rawInit = parseInt(e.currentTarget.value, 10)
                          const init = Number.isFinite(rawInit)
                            ? Math.min(sliderMax, Math.max(0, rawInit))
                            : 0
                          setAllocSliderRawOverride({ idx, raw: init })
                          try {
                            e.currentTarget.setPointerCapture(e.pointerId)
                          } catch {
                            /* noop */
                          }
                        }}
                        onPointerUp={e => {
                          try {
                            e.currentTarget.releasePointerCapture(e.pointerId)
                          } catch {
                            /* noop */
                          }
                          commitOnboardingSliderSnap(idx, e.currentTarget)
                        }}
                        onPointerCancel={e => {
                          try {
                            e.currentTarget.releasePointerCapture(e.pointerId)
                          } catch {
                            /* noop */
                          }
                          commitOnboardingSliderSnap(idx, e.currentTarget)
                        }}
                        onBlur={e => {
                          commitOnboardingSliderSnap(idx, e.currentTarget)
                        }}
                        onFocus={() => setActiveEnvIdx(idx)}
                        style={{
                          "--slider-color": env.color,
                          "--slider-pct": `${sliderPct}%`,
                        } as React.CSSProperties}
                      />
                      {env.allocationCadence !== "monthly" && env.monthlyAllotment > 0 && (
                        <span className="text-[10px] text-muted-foreground mt-0.5">
                          = ${Math.round(env.monthlyAllotment).toLocaleString()}/mo
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Implicit Savings row */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-[#1A1A1A]/60 border border-[#1F1F1F]">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-[#22C55E]/10">
                  <PiggyBank className="h-4 w-4 text-[#22C55E]" />
                </div>
                <span className="flex-1 text-sm font-medium text-muted-foreground">Savings</span>
                <div className="flex items-baseline gap-1.5 shrink-0">
                  <span className="text-sm font-semibold text-[#22C55E]">${savings.toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground w-10 text-right">{savingsPct}%</span>
                </div>
              </div>

              {savings === 0 && totalAllocated > 0 && (
                <p className="text-xs text-amber-400/80 text-center">That piggybank is looking a bit empty :'(</p>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep("envelopes")}
                  className="flex-1 py-3 bg-[#1A1A1A] text-foreground rounded-xl font-semibold text-sm hover:bg-[#222] transition-colors border border-[#333] flex items-center justify-center gap-2"
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? "Saving..." : "Continue"}
                  {!loading && <ChevronRight className="h-4 w-4" />}
                </button>
              </div>
              <OnboardingSkipBar
                show={canSkipOnboarding && bootstrapped}
                disabled={loading}
                onSkip={skipOnboardingToDashboard}
              />
            </form>
          )}

          {/* Import Step */}
          {step === "import" && (
            <form
              onSubmit={e => { e.preventDefault(); handleImport() }}
              className="flex w-full min-w-0 flex-col gap-6"
            >
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-[#06B6D4]/10">
                  <Upload className="h-6 w-6 text-[#06B6D4]" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-xl font-bold text-foreground">Import Transactions</h2>
                  <p className="text-sm text-muted-foreground">Optionally import history from a CSV</p>
                </div>
              </div>

              {/* items-stretch (not items-center) so file row and hints use full card width on mobile */}
              <div className="flex w-full min-w-0 flex-col items-stretch gap-4 p-6 border-2 border-dashed border-[#333] rounded-xl">
                <input
                  ref={importFileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={e => {
                    setImportFile(e.target.files?.[0] || null)
                    setImportResult(null)
                  }}
                  className="w-full min-w-0 text-sm text-muted-foreground file:mr-0 file:mb-3 file:block file:w-full file:py-2.5 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[#F7931A] file:text-[#0D0D0D] hover:file:bg-[#F7931A]/90 sm:file:mr-4 sm:file:mb-0 sm:file:inline-block sm:file:w-auto"
                />
                <p className="text-xs text-muted-foreground text-center">
                  CSV should have columns: Date, Envelope, Name, Amount
                </p>
              </div>

              {/* grid: reliable equal-width actions on narrow viewports (flex-1 alone can collapse oddly on some mobile browsers) */}
              <div className="grid w-full min-w-0 grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setStep("allocations")}
                  className="min-w-0 py-3 bg-[#1A1A1A] text-foreground rounded-xl font-semibold text-sm hover:bg-[#222] transition-colors border border-[#333] flex items-center justify-center gap-2"
                >
                  <ChevronLeft className="h-4 w-4 shrink-0" /> Back
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="min-w-0 py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50 flex items-center justify-center text-center px-2"
                >
                  {loading ? "Importing..." : importFile ? "Import & Continue" : "Skip"}
                </button>
              </div>
              <OnboardingSkipBar
                show={canSkipOnboarding && bootstrapped}
                disabled={loading}
                onSkip={skipOnboardingToDashboard}
              />
            </form>
          )}

          {/* Complete Step */}
          {step === "complete" && (
            <form onSubmit={e => { e.preventDefault(); handleComplete() }} className="flex flex-col items-center gap-6 py-4">
              <div className="p-4 rounded-full bg-[#22C55E]/10">
                <svg className="h-10 w-10 text-[#22C55E]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-foreground">You&apos;re All Set!</h2>
              <p className="text-sm text-muted-foreground text-center">
                Your envelopes are ready and your data is secured.
              </p>
              {refereeTrialExplainerOnComplete ? (
                <div className="w-full rounded-xl border border-[#3B82F6]/35 bg-[#3B82F6]/10 px-4 py-3 text-left space-y-2">
                  <p className="text-sm text-foreground font-medium">Your referral</p>
                  <p className="text-sm text-muted-foreground">
                    <strong className="text-foreground">
                      {pendingReferral?.refereeTrialMonths === 1 || pendingReferral?.refereeTrialMonths === 3
                        ? refereePremiumExperienceCarrot(pendingReferral.refereeTrialMonths)
                        : REFEREE_PREMIUM_CARROT_FALLBACK}
                    </strong>{" "}
                    Next, you&apos;ll connect your bank in a dedicated step. Your premium trial only starts after a successful link—take your time
                    exploring BitBudget first if you like.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Until you link a bank, Plan may show <strong className="text-foreground">Free</strong> — that&apos;s expected. Receipt inbox and SMS
                    unlock when your trial starts.
                  </p>
                </div>
              ) : (
                <Collapsible
                  open={completeReferralOpen}
                  onOpenChange={setCompleteReferralOpen}
                  className="w-full max-w-sm space-y-3"
                >
                  <p className="text-xs text-muted-foreground text-center">
                    Wait! Did you have a referral code?
                  </p>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="mx-auto block text-sm font-medium text-[#F7931A] hover:text-[#F7931A]/90 underline underline-offset-2 transition-colors"
                      aria-expanded={completeReferralOpen}
                    >
                      Enter referral code
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-2 pt-1">
                    <Label htmlFor="complete-referral-code" className="text-muted-foreground text-xs uppercase tracking-wider">
                      Code
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id="complete-referral-code"
                        value={refCodeInput}
                        onChange={e => {
                          setRefCodeInput(e.target.value)
                          if (refError) setRefError(null)
                        }}
                        placeholder="Enter code"
                        className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555] flex-1"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={refValidating || !refCodeInput.trim()}
                        className="shrink-0 border-[#333] bg-[#1A1A1A]"
                        onClick={() => {
                          void applyReferralCodeFromInput()
                        }}
                      >
                        {refValidating ? "…" : "Apply"}
                      </Button>
                    </div>
                    {refError && <p className="text-sm text-red-400">{refError}</p>}
                    <p className="text-xs text-muted-foreground">
                      Connect your bank after signup to start your premium trial — no payment details required.
                    </p>
                  </CollapsibleContent>
                </Collapsible>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50"
              >
                {loading ? "Finishing..." : refereeTrialExplainerOnComplete ? "Continue" : "Go to Dashboard"}
              </button>
            </form>
          )}

          {step === "referral-bank" && (
            <div className="flex flex-col gap-6 py-2">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-[#F7931A]/10">
                  <Building2 className="h-6 w-6 text-[#F7931A]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Connect your bank</h2>
                  <p className="text-sm text-muted-foreground">
                    Last step for your referral: link an account with Plaid. Skip if you&apos;re not ready—we&apos;ll remind you later on the
                    dashboard.
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-[#3B82F6]/35 bg-[#3B82F6]/10 px-4 py-3 space-y-2">
                <p className="text-sm text-muted-foreground">
                  <strong className="text-foreground">
                    {pendingReferral?.refereeTrialMonths === 1 || pendingReferral?.refereeTrialMonths === 3
                      ? refereePremiumExperienceCarrot(pendingReferral.refereeTrialMonths)
                      : REFEREE_PREMIUM_CARROT_FALLBACK}
                  </strong>
                </p>
                <p className="text-xs text-muted-foreground">
                  Your premium trial clock starts only after your first successful bank link. You can also connect anytime under Settings →
                  Integrations.
                </p>
              </div>
              <div className="flex flex-col items-stretch gap-2">
                <p className="text-xs text-muted-foreground text-center">Bank sync (Plaid)</p>
                <div className="flex justify-center">
                  <PlaidLinkButton />
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setStep("complete")}
                    className="py-3 bg-[#1A1A1A] text-foreground rounded-xl font-semibold text-sm hover:bg-[#222] transition-colors border border-[#333] flex items-center justify-center gap-2"
                  >
                    <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => finishOnboardingExit()}
                    className="py-3 bg-[#1A1A1A] text-foreground rounded-xl font-semibold text-sm hover:bg-[#222] transition-colors border border-[#333]"
                  >
                    Skip for now
                  </button>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  If you skip, we&apos;ll show occasional reminders until you connect. Your trial won&apos;t start until then.
                </p>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            try {
              sessionStorage.removeItem(ONBOARDING_SESSION_STORAGE_KEY)
              sessionStorage.removeItem("nostr-login")
            } catch {}
            signOut({ callbackUrl: "/auth" })
          }}
          className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors py-4"
        >
          Wrong account? Sign out
        </button>
      </div>

      <AlertDialog
        open={pendingDeleteEnvelopeIdx !== null}
        onOpenChange={open => {
          if (open) return
          if (deletingEnvelopeIdx !== null) return
          setPendingDeleteEnvelopeIdx(null)
        }}
      >
        <AlertDialogContent className="border-[#333] bg-[#0D0D0D] sm:rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {pendingDeleteEnv ? `“${pendingDeleteEnv.name}”` : "envelope"}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-muted-foreground text-sm space-y-2">
                {!pendingDeleteEnv ? (
                  <p>This envelope is no longer in your list.</p>
                ) : envelopeUsageLoading || !envelopeUsageHydrated ? (
                  <p className="flex items-center gap-2">
                    <Spinner className="h-4 w-4 shrink-0" />
                    Checking whether this envelope has linked transactions or recurring rules…
                  </p>
                ) : !pendingDeleteUsageReady ? (
                  <div className="space-y-3">
                    <p>
                      We couldn&apos;t load usage for this envelope yet. Removing it may permanently delete
                      associated transactions and recurring rules. Try loading usage again, or cancel and
                      continue once your connection is stable.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-[#333] bg-[#1A1A1A] hover:bg-[#252525]"
                      disabled={envelopeUsageLoading}
                      onClick={() => {
                        void refreshEnvelopeUsage()
                      }}
                    >
                      Retry
                    </Button>
                  </div>
                ) : pendingDeleteTxs === 0 && pendingDeleteRec === 0 ? (
                  <p>
                    This envelope will be removed from your list. You can add it again before you continue.
                  </p>
                ) : (
                  <p>
                    This will permanently delete{" "}
                    {[
                      pendingDeleteTxs > 0
                        ? `${pendingDeleteTxs} transaction${pendingDeleteTxs === 1 ? "" : "s"}`
                        : null,
                      pendingDeleteRec > 0
                        ? `${pendingDeleteRec} recurring rule${pendingDeleteRec === 1 ? "" : "s"}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" and ")}{" "}
                    in this envelope. This cannot be undone.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deletingEnvelopeIdx !== null}
              className="border-[#333] bg-[#1A1A1A] hover:bg-[#252525]"
            >
              Cancel
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={
                deletingEnvelopeIdx !== null ||
                !pendingDeleteEnv ||
                !pendingDeleteUsageReady
              }
              onClick={() => { void confirmDeleteEnvelope() }}
              className="gap-2"
            >
              {deletingEnvelopeIdx !== null ? (
                <>
                  <Spinner className="h-4 w-4" />
                  Removing…
                </>
              ) : (
                "Remove envelope"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CSVImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        file={importFile}
        dedupExistingTransactions={[]}
        onImportResult={summary => {
          setImportResult(summary)
          setImportFile(null)
          clearOnboardingImportFileInput()
          // Refresh draft envelopes if user dismisses the dialog (close/overlay) instead of “Update allocations”.
          void mergeEnvelopesStateFromServer()
          void refreshEnvelopeUsage()
        }}
        onDone={() => setStep("complete")}
        onRequestAllocations={async () => {
          const merged = await mergeEnvelopesStateFromServer()
          if (!merged) {
            throw new Error(
              "Could not refresh your envelopes from the server. Check your connection and try again.",
            )
          }
          setImportDialogOpen(false)
          setStep("allocations")
        }}
        onTryAnotherFile={() => {
          setImportFile(null)
          setImportResult(null)
          clearOnboardingImportFileInput()
        }}
      />
    </div>
  )
}
