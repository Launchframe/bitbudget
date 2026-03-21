"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { signOut } from "next-auth/react"
import { BitbudgetLogo } from "@/components/bitbudget-logo"
import { DocumentFavicon } from "@/components/document-favicon"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Plus, Trash2, Pencil, ChevronRight, ChevronLeft, Lock, Wallet, DollarSign, PiggyBank, PieChart, Upload, X, ShieldCheck } from "lucide-react"
import { EnvelopeAppearancePicker } from "@/components/envelope-appearance-picker"
import {
  suggestIcon,
  filterSuggestions,
  pickEnvelopeIconForName,
} from "@/lib/envelope-icons"
import { EnvelopeIconDisplay } from "@/components/envelope-icon-display"
import { CSVImportDialog } from "@/components/csv-import-dialog"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  deriveKeyFromPin,
  generateSalt,
  generatePrivacyKey,
  encryptPrivacyKey,
  uint8ToHex,
} from "@/lib/crypto"
import { syncUserPublicKey } from "@/lib/sync-user-public-key"
import {
  getPendingNsec,
  clearPendingNsec,
  hasNsecOnboardingIntent,
  clearNsecOnboardingIntent,
} from "@/lib/nostr-local-signer"
import {
  monthlyBudgetForAllocation,
  ONBOARDING_ALLOCATE_SLIDER_STEP,
} from "@/lib/onboarding-allocate-budget"
import {
  cadenceDisplayInteger,
  fromMonthly,
  monthlyFromDigitOnlyInput,
  toMonthly,
  type AllocationCadence,
} from "@/lib/allocation-cadence"

type Step = "security" | "income" | "envelopes" | "allocations" | "import" | "complete"

// Opportunity cost is set from entry point (/welcome or / → vanilla off; /landing → btc on), not a separate step.
const STEPS: Step[] = ["security", "income", "envelopes", "allocations", "import", "complete"]
const ENVELOPE_COLORS = ["#F7931A", "#3B82F6", "#10B981", "#8B5CF6", "#EF4444", "#EAB308", "#EC4899", "#06B6D4"]

interface DraftEnvelope {
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
  const [step, setStep] = useState<Step>("security")
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
  const [envelopes, setEnvelopes] = useState<DraftEnvelope[]>([
    { name: "Rent", color: ENVELOPE_COLORS[0], icon: suggestIcon("Rent"), monthlyAllotment: 0, allocationCadence: "monthly" },
    { name: "Food", color: ENVELOPE_COLORS[2], icon: suggestIcon("Food"), monthlyAllotment: 0, allocationCadence: "monthly" },
    { name: "Transportation", color: ENVELOPE_COLORS[4], icon: suggestIcon("Transportation"), monthlyAllotment: 0, allocationCadence: "monthly" },
  ])
  const [newEnvName, setNewEnvName] = useState("")
  const [showEnvSuggestions, setShowEnvSuggestions] = useState(false)
  const [expandedEnvIdx, setExpandedEnvIdx] = useState<number | null>(null)

  // Allocations
  const [activeEnvIdx, setActiveEnvIdx] = useState<number | null>(null)
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

  // Import
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importResult, setImportResult] = useState<{
    imported: number
    skipped: number
    newEnvelopes: string[]
  } | null>(null)

  // Opportunity cost: enabled only for users who entered from /landing (see landing vs welcome pages).
  const [onboardingSource] = useState<"btc" | "vanilla">(() => {
    try {
      const src = sessionStorage.getItem("onboardingSource")
      return src === "btc" ? "btc" : "vanilla"
    } catch { return "vanilla" }
  })
  const opportunityCostEnabled = onboardingSource === "btc"

  const STORAGE_KEY = "bitbudget-onboarding"
  const [hydrated, setHydrated] = useState(false)
  const [restoredSession, setRestoredSession] = useState(false)
  /** After first encryption + settings fetch (avoids flashing Secure Your Data when keys already exist). */
  const [bootstrapped, setBootstrapped] = useState(false)
  const [hasExistingEncryption, setHasExistingEncryption] = useState(false)
  /** Shown when user already has transactions — safe escape if onboardingComplete was reset by mistake. */
  const [canSkipOnboarding, setCanSkipOnboarding] = useState(false)
  const [skipOnboardingError, setSkipOnboardingError] = useState<string | null>(null)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw)
        if (saved.step && saved.step !== "security") {
          const restoredStep: Step =
            saved.step === "opportunity-cost" ? "complete" : saved.step
          setStep(restoredStep)
          setRestoredSession(true)
        }
        if (saved.income) setIncome(saved.income)
        if (saved.cadence) setCadence(saved.cadence)
        if (saved.envelopes?.length) setEnvelopes(
          saved.envelopes.map((e: { allocationCadence?: string; monthlyAllotment?: number }) => {
            const raw = typeof e.monthlyAllotment === "number" ? e.monthlyAllotment : 0
            return {
              ...e,
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
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        step,
        income,
        cadence,
        envelopes,
      }))
    } catch { /* storage full or unavailable */ }
  }, [hydrated, step, income, cadence, envelopes])

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

  const stepIndex = STEPS.indexOf(step)
  const progress = ((stepIndex + 1) / STEPS.length) * 100

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
          // we remain on "security" — the passphrase branch renders `null` and the card is blank.
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
                  sessionStorage.setItem("bitbudget-privacy-key", uint8ToHex(privacyKey))
                  if (enc.userId) sessionStorage.setItem("bitbudget-privacy-user", enc.userId)
                  await syncUserPublicKey(privacyKey)
                  hasEnc = true
                }
              }
            } catch {
              // NIP-04 encrypt was rejected or unavailable (e.g. keys.band authorized
              // getPublicKey but not nip04, or user denied the prompt). Continue without
              // auto-provisioning; the step routing below still advances past security.
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

          // Security UI only renders when (!isNostr || isNsecFallback). Extension Nostr users who
          // are not on the nsec-fallback path must never stay on "security" without that UI
          // (e.g. NIP-04 missing or POST failed would otherwise leave a blank card). Nsec users
          // with a pending key stay on Security for PIN; everyone else advances to Income.
          setStep(prev => {
            if (prev !== "security") return prev
            if (hasPendingNsec) return "security"
            return "income"
          })
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
      try {
        sessionStorage.removeItem(STORAGE_KEY)
        sessionStorage.removeItem("onboardingSource")
        sessionStorage.removeItem("nostr-login")
      } catch { /* ignore */ }
      router.push("/")
      router.refresh()
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
          sessionStorage.setItem("bitbudget-privacy-key", uint8ToHex(privacyKey))
          if (userId) sessionStorage.setItem("bitbudget-privacy-user", userId)
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
    try {
      for (const env of list) {
        await fetch("/api/envelopes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: env.name, color: env.color, icon: env.icon, monthlyAllotment: env.monthlyAllotment }),
        })
      }
      enterAllocations(list)
    } finally {
      setLoading(false)
    }
  }

  async function handleAllocationsSave() {
    setLoading(true)
    try {
      const res = await fetch("/api/envelopes")
      const serverEnvelopes = await res.json()

      for (let i = 0; i < envelopes.length; i++) {
        const serverEnv = serverEnvelopes.find(
          (e: { name: string }) => e.name === envelopes[i].name,
        )
        if (serverEnv && envelopes[i].monthlyAllotment > 0) {
          await fetch("/api/envelopes", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: serverEnv.id,
              monthlyAllotment: envelopes[i].monthlyAllotment,
            }),
          })
        }
      }
      setStep("import")
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
      await fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboardingComplete: true, opportunityCostEnabled }),
      })
      try {
        sessionStorage.removeItem(STORAGE_KEY)
        sessionStorage.removeItem("onboardingSource")
        sessionStorage.removeItem("nostr-login")
      } catch {}
      router.push("/")
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  const totalAllocated = envelopes.reduce((s, e) => s + e.monthlyAllotment, 0)
  const allocateMonthlyBudget = monthlyBudgetForAllocation(parseFloat(income) || 0, cadence)
  const savings = Math.max(0, allocateMonthlyBudget - totalAllocated)
  const savingsPct =
    allocateMonthlyBudget > 0 ? Math.round((savings / allocateMonthlyBudget) * 100) : 0

  return (
    <div className="min-h-screen bg-background flex flex-col items-center p-6">
      <DocumentFavicon href={opportunityCostEnabled ? "/icon.svg" : "/icon-vanilla.svg"} />
      <div className="w-full max-w-lg flex flex-col gap-6 pt-8">
        <div className="flex items-center justify-between">
          <BitbudgetLogo variant={opportunityCostEnabled ? "btc" : "vanilla"} />
          <span className="text-xs text-muted-foreground">
            Step {stepIndex + 1} of {STEPS.length}
          </span>
        </div>

        <Progress value={progress} className="h-1.5" />

        {skipOnboardingError && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {skipOnboardingError}
          </div>
        )}

        <div className="bg-[#0D0D0D] rounded-2xl p-8">
          {restoredSession && !isNostr && step !== "security" && step !== "complete" && (
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

          {/* Security Step: Web 2.0 users and nsec fallback users (Nostr without extension) */}
          {step === "security" && (!isNostr || isNsecFallback) && (
            !bootstrapped ? (
              <div className="flex flex-col items-center justify-center gap-4 py-16">
                <Spinner className="h-8 w-8 text-[#F7931A]" />
                <p className="text-sm text-muted-foreground text-center">Checking your account…</p>
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

                <button
                  type="submit"
                  disabled={loading || !pin || !pinConfirm}
                  className="w-full py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? "Setting up..." : "Continue"}
                  {!loading && <ChevronRight className="h-4 w-4" />}
                </button>
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
                  <h2 className="text-xl font-bold text-foreground">Your Income</h2>
                  <p className="text-sm text-muted-foreground">How much do you earn after taxes?</p>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label className="text-muted-foreground text-xs uppercase tracking-wider">After-Tax Income (USD)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      type="number"
                      value={income}
                      onChange={e => setIncome(e.target.value)}
                      placeholder="5,000"
                      className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555] pl-7 text-lg"
                      min="0"
                      step="100"
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

              <button
                type="submit"
                disabled={loading || !income}
                className="w-full py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? "Saving..." : "Continue"}
                {!loading && <ChevronRight className="h-4 w-4" />}
              </button>
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
                  <h2 className="text-xl font-bold text-foreground">Your Envelopes</h2>
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
                            className="h-4 w-4 text-[10px]"
                            style={{ color: env.color }}
                          />
                        </button>
                        <span className="flex-1 text-sm font-medium text-foreground">{env.name}</span>
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
                          onClick={() => { removeEnvelope(idx); if (expandedEnvIdx === idx) setExpandedEnvIdx(null) }}
                          className="p-1 text-muted-foreground hover:text-red-400 transition-colors"
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
                            existingEnvelopes={envelopes.map((e, i) => ({ id: String(i), name: e.name, icon: e.icon }))}
                            editingId={String(idx)}
                            onColorChange={color => setEnvelopes(prev => prev.map((e, i) => i === idx ? { ...e, color } : e))}
                            onIconChange={icon => setEnvelopes(prev => prev.map((e, i) => i === idx ? { ...e, icon } : e))}
                            onReassignIcon={fromId => {
                              const fromIdx = parseInt(fromId)
                              setEnvelopes(prev => prev.map((e, i) => i === fromIdx ? { ...e, icon: "Wallet" } : e))
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
                                icon={suggestIcon(name)}
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

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep("income")}
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
                }
                input[type="range"].alloc-slider::-webkit-slider-thumb:active {
                  cursor: grabbing;
                  transform: scale(1.15);
                }
                input[type="range"].alloc-slider::-moz-range-thumb {
                  width: 22px;
                  height: 22px;
                  border-radius: 50%;
                  background: var(--slider-color);
                  border: 3px solid #0D0D0D;
                  box-shadow: 0 0 0 2px var(--slider-color);
                  cursor: grab;
                }
                input[type="range"].alloc-slider::-moz-range-thumb:active {
                  cursor: grabbing;
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
                  <h2 className="text-xl font-bold text-foreground">Allocate Income</h2>
                  <p className="text-sm text-muted-foreground">
                    How do you want to split your{" "}
                    <span className="text-foreground font-medium">
                      ${allocateMonthlyBudget.toLocaleString()}
                    </span>{" "}
                    monthly budget across envelopes?
                  </p>
                </div>
              </div>

              {/* Stacked bar — sticky while scrolling envelope sliders */}
              {allocateMonthlyBudget > 0 && (
                <div
                  className="sticky top-0 z-20 -mx-8 px-8 py-3 -mt-2 mb-2 bg-[#0D0D0D] border-b border-[#1F1F1F] shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
                >
                  <div className="flex flex-col gap-2">
                  <div className="flex h-10 rounded-xl overflow-hidden bg-[#1A1A1A]">
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
                              className={`flex min-w-0 items-center justify-center relative ${
                                activeEnvIdx === idx ? "brightness-110" : "hover:brightness-110"
                              }`}
                              style={{
                                flex: `${env.monthlyAllotment} 0 0px`,
                                backgroundColor: env.color,
                                minWidth: 4,
                              }}
                              aria-label={`${env.name}, $${amt.toLocaleString()} per month allocated`}
                            >
                              {pct > 8 && (
                                <EnvelopeIconDisplay
                                  icon={env.icon}
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
                            className="flex min-w-0 items-center justify-center cursor-default"
                            style={{
                              flex: `${savings} 0 0px`,
                              backgroundColor: "rgba(34, 197, 94, 0.25)",
                              minWidth: 4,
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
                  <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                    <span>${totalAllocated.toLocaleString()} allocated</span>
                    <span>${allocateMonthlyBudget.toLocaleString()} monthly budget</span>
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
                  const rangeDisplayValue = Math.min(
                    sliderMax,
                    Math.max(
                      0,
                      Math.round(env.monthlyAllotment / ONBOARDING_ALLOCATE_SLIDER_STEP) *
                        ONBOARDING_ALLOCATE_SLIDER_STEP,
                    ),
                  )
                  const sliderPct = sliderMax > 0 ? (rangeDisplayValue / sliderMax) * 100 : 0

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
                        max={sliderMax}
                        step={ONBOARDING_ALLOCATE_SLIDER_STEP}
                        value={rangeDisplayValue}
                        aria-label={`${env.name} monthly allotment`}
                        onChange={e => {
                          const val = parseInt(e.target.value, 10) || 0
                          setEnvelopes(prev => prev.map((en, i) =>
                            i === idx ? { ...en, monthlyAllotment: val } : en,
                          ))
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
                <p className="text-xs text-amber-400/80 text-center">All income allocated — nothing goes to savings</p>
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
                {importResult && ` Imported ${importResult.imported} transactions.`}
              </p>
              {importResult && importResult.newEnvelopes.length > 0 && (
                <p className="text-xs text-muted-foreground text-center">
                  New envelopes created from import: {importResult.newEnvelopes.join(", ")}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50"
              >
                {loading ? "Finishing..." : "Go to Dashboard"}
              </button>
            </form>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            try {
              sessionStorage.removeItem(STORAGE_KEY)
              sessionStorage.removeItem("nostr-login")
            } catch {}
            signOut({ callbackUrl: "/auth" })
          }}
          className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors py-4"
        >
          Wrong account? Sign out
        </button>
      </div>
      <CSVImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        file={importFile}
        dedupExistingTransactions={[]}
        onImportResult={setImportResult}
        onDone={() => setStep("complete")}
        onRequestAllocations={() => {
          setImportDialogOpen(false)
          setStep("allocations")
        }}
        onTryAnotherFile={() => {
          setImportFile(null)
          setImportResult(null)
        }}
      />
    </div>
  )
}
