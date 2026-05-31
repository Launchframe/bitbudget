"use client"

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import { signOut } from "next-auth/react"
import { BitbudgetLogo } from "@/components/bitbudget-logo"
import { DocumentFavicon } from "@/components/document-favicon"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Plus, Trash2, Pencil, ChevronRight, ChevronLeft, Lock, Wallet, DollarSign, PiggyBank, PieChart, Upload, X, ShieldCheck, Gift, Building2, Target } from "lucide-react"
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
import {
  ONBOARDING_HINT_ENVELOPES,
  ONBOARDING_HINT_REFERRAL_BANK,
  ONBOARDING_HINT_REFERRAL_COMPLETE,
  ONBOARDING_HINT_SAVINGS_GOAL,
  ONBOARDING_HINT_SAVINGS_SWEEP,
  OnboardingDismissibleHint,
} from "@/components/onboarding-dismissible-hint"
import { PlaidConnectionsSection } from "@/components/plaid-connections-section"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
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
import { OnboardingAllocFineScroller } from "@/components/onboarding-alloc-fine-scroller"
import {
  applyUnboundedOnboardingSliderDrag,
  bumpUnboundedOnboardingSliderVisitedMax,
  unboundedOnboardingSliderMaxForGestureWithVisited,
  unboundedOnboardingSliderVisitedMax,
  unboundedOnboardingSliderThumbPct,
  defaultOnboardingSavingsGoalAmount,
  isUnboundedOnboardingAllocation,
  monthlyBudgetForAllocation,
  monthlyCapacityFromAnnualEstimate,
  nudgeOnboardingAllocationAmount,
  onboardingAllocationCapForRow,
  onboardingOverrideDisplayAmount,
  ONBOARDING_ALLOCATE_FINE_STEP,
  ONBOARDING_ALLOCATE_SLIDER_STEP,
  onboardingSavingsGoalAmountFromPercent,
  onboardingSavingsGoalCapacity,
  onboardingSavingsGoalFromManualInput,
  onboardingSavingsGoalPercentOfCapacity,
  onboardingSavingsGoalSliderMaxPct,
  scaleOnboardingAllocationsToBudget,
  ONBOARDING_SAVINGS_GOAL_DEFAULT_PCT,
  ONBOARDING_UNBOUNDED_INPUT_MAX,
  onboardingSliderMaxForRow,
  savingsGoalPercentOfPaycheck,
  snapOnboardingAllocationToStep,
  type OnboardingPayCadence,
} from "@/lib/onboarding-allocate-budget"
import {
  isOnboardingDraftBudgetEnvelope,
  isOnboardingVisibleServerEnvelope,
  withoutSystemSavingsEnvelope,
} from "@/lib/onboarding-draft-envelopes"
import {
  PAYDAY_LAST_OF_MONTH,
} from "@/lib/payday-cadence"
import {
  ENVELOPE_DELETE_GRACE_DAYS,
  SAVINGS_EXPERIENCE_DISMISSED,
  SAVINGS_GOLD_ACCENT,
  SWEEP_POLICY_CARRY_FORWARD,
} from "@/lib/constants"
import { formatUsd } from "@/lib/data"
import { SAVINGS_GOAL_DEFAULT_PERIOD } from "@/lib/savings-goal"
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
import {
  REFERRAL_REDEEM_SUCCESS_MESSAGE,
  REFERRAL_VALIDATE_SUCCESS_HINT,
  referralRedeemErrorMessage,
  setReferralRedeemFlash,
} from "@/lib/referral-redeem-messages"

type Step =
  | "referral"
  | "security"
  | "income"
  | "envelopes"
  | "allocations"
  | "savings-game-plan"
  | "import"
  | "complete"
  | "referral-bank"

type IncomeMode = "regular" | "irregular" | "mix"
type AllocPhase = "budget" | "savings-goal"

// Opportunity cost is set from entry point (/welcome or / → vanilla off; /landing → btc on), not a separate step.
const STEPS: Step[] = [
  "referral",
  "security",
  "income",
  "envelopes",
  "allocations",
  "savings-game-plan",
  "import",
  "complete",
]

const WEEKDAY_OPTIONS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
]

const PAYDAY_DOM_OPTIONS = [
  ...Array.from({ length: 28 }, (_, i) => i + 1),
  PAYDAY_LAST_OF_MONTH,
] as const
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
        If you do not have more transactions you want to import, you can{" "}
        <span className="font-bold">skip ahead to finish onboarding</span>.
      </p>
      <button
        type="button"
        disabled={disabled}
        onClick={onSkip}
        className="w-full py-2.5 text-sm font-medium text-muted-foreground border border-[#333] rounded-xl hover:bg-[#1A1A1A] hover:text-foreground transition-colors disabled:opacity-50"
      >
        Skip
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
  const [incomeMode, setIncomeMode] = useState<IncomeMode>("regular")
  const [income, setIncome] = useState("")
  const [cadence, setCadence] = useState<OnboardingPayCadence>("monthly")
  const [payDays, setPayDays] = useState<number[]>([1])
  const [payDayOfWeek, setPayDayOfWeek] = useState(5)
  const [lastPaydayAt, setLastPaydayAt] = useState(() => new Date().toISOString().split("T")[0]!)
  const [estimatedAnnualIncome, setEstimatedAnnualIncome] = useState("")

  // Allocations
  const [allocPhase, setAllocPhase] = useState<AllocPhase>("budget")
  const [dismissedOnboardingHints, setDismissedOnboardingHints] = useState<Set<string>>(() => new Set())
  const dismissOnboardingHint = useCallback((hintId: string) => {
    setDismissedOnboardingHints(prev => {
      if (prev.has(hintId)) return prev
      const next = new Set(prev)
      next.add(hintId)
      return next
    })
  }, [])
  const [savingsGoalAmount, setSavingsGoalAmount] = useState(0)
  const [savingsGoalPct, setSavingsGoalPct] = useState(10)
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
  /** Sync mirror of override — release/commit read this within the same pointer event as nudge. */
  const allocSliderRawOverrideRef = useRef<{ idx: number; raw: number } | null>(null)
  const syncAllocSliderRawOverride = useCallback(
    (
      update:
        | { idx: number; raw: number }
        | null
        | ((
            prev: { idx: number; raw: number } | null,
          ) => { idx: number; raw: number } | null),
    ) => {
      if (typeof update === "function") {
        setAllocSliderRawOverride(prev => {
          const next = update(prev)
          allocSliderRawOverrideRef.current = next
          return next
        })
      } else {
        allocSliderRawOverrideRef.current = update
        setAllocSliderRawOverride(update)
      }
    },
    [],
  )
  const allocSliderRawForRow = useCallback((rowIdx: number, fallback: number) => {
    const override = allocSliderRawOverrideRef.current
    return override?.idx === rowIdx ? override.raw : fallback
  }, [])
  const sliderRowRefs = useRef<(HTMLDivElement | null)[]>([])
  const allocSliderRangeInputRefs = useRef<(HTMLInputElement | null)[]>([])
  const allocSliderPointerRef = useRef<{ pointerId: number; idx: number } | null>(null)
  const allocSliderPendingPointerRef = useRef<{
    pointerId: number
    idx: number
    startX: number
    startY: number
    gestureMax: number
    init: number
    committed: boolean
  } | null>(null)
  /** Coarse horizontal slider vs fine scroller — controls snap step and live display. */
  const allocSliderGestureKindRef = useRef<"coarse" | "fine" | null>(null)
  const allocSliderDragSessionRef = useRef<{
    idx: number
    lockedMax: number
    expandedFrom: Set<number>
  } | null>(null)
  const [allocSliderLockedMax, setAllocSliderLockedMax] = useState<{ idx: number; max: number } | null>(
    null,
  )
  /** Unbounded onboarding: largest slider range reached per envelope row (expand-only for the session). */
  const [allocSliderUnboundedVisitedMax, setAllocSliderUnboundedVisitedMax] = useState<
    Record<number, number>
  >({})
  const allocSliderSkipBlurCommitRef = useRef<number | null>(null)

  const bumpUnboundedSliderVisitedMaxForRow = useCallback((rowIdx: number, candidate: number) => {
    setAllocSliderUnboundedVisitedMax(prev => ({
      ...prev,
      [rowIdx]: bumpUnboundedOnboardingSliderVisitedMax(prev[rowIdx], candidate),
    }))
  }, [])

  const clearUnboundedSliderVisitedMaxForRow = useCallback((rowIdx: number) => {
    setAllocSliderUnboundedVisitedMax(prev => {
      if (prev[rowIdx] == null) return prev
      const next = { ...prev }
      delete next[rowIdx]
      return next
    })
  }, [])

  /** Append one draft envelope from trimmed name (shared by Add button and Continue). */
  function appendDraftEnvelope(prev: DraftEnvelope[], rawName: string): DraftEnvelope[] {
    const trimmed = rawName.trim()
    if (!trimmed || !isOnboardingDraftBudgetEnvelope({ name: trimmed })) return prev
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
    setAllocPhase("budget")
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
    duplicates: number
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
  const [envelopeStepError, setEnvelopeStepError] = useState<string | null>(null)
  /** Server-side tx / recurring counts per envelope id — used for delete confirmation copy. */
  const [envelopeUsageById, setEnvelopeUsageById] = useState<
    Record<string, { transactionCount: number; transactionTotalAmount: number; recurringCount: number }>
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
  const [completeFinishError, setCompleteFinishError] = useState<string | null>(null)
  const [setupApiError, setSetupApiError] = useState<string | null>(null)

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
        transactionTotalAmount?: number
        recurringCount?: number
      }>
      const next: Record<string, { transactionCount: number; transactionTotalAmount: number; recurringCount: number }> = {}
      for (const r of rows) {
        if (!r.id) continue
        next[r.id] = {
          transactionCount: typeof r.transactionCount === "number" ? r.transactionCount : 0,
          transactionTotalAmount:
            typeof r.transactionTotalAmount === "number" ? r.transactionTotalAmount : 0,
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
        if (saved.incomeMode) setIncomeMode(saved.incomeMode)
        if (saved.cadence) setCadence(saved.cadence)
        if (Array.isArray(saved.payDays) && saved.payDays.length > 0) setPayDays(saved.payDays)
        if (typeof saved.payDayOfWeek === "number") setPayDayOfWeek(saved.payDayOfWeek)
        if (typeof saved.lastPaydayAt === "string") setLastPaydayAt(saved.lastPaydayAt)
        if (saved.estimatedAnnualIncome) setEstimatedAnnualIncome(saved.estimatedAnnualIncome)
        if (saved.allocPhase) setAllocPhase(saved.allocPhase)
        if (typeof saved.savingsGoalAmount === "number") {
          setSavingsGoalAmount(saved.savingsGoalAmount)
        } else if (saved.allocPhase === "savings-goal") {
          const regular =
            saved.incomeMode !== "irregular"
              ? monthlyBudgetForAllocation(parseFloat(saved.income) || 0, saved.cadence ?? "monthly")
              : 0
          const irregular =
            saved.incomeMode === "irregular" || saved.incomeMode === "mix"
              ? monthlyCapacityFromAnnualEstimate(parseFloat(saved.estimatedAnnualIncome) || 0)
              : 0
          const budget = regular + irregular
          const restoredTotal =
            saved.envelopes?.reduce(
              (sum: number, e: { monthlyAllotment?: number }) =>
                sum + (typeof e.monthlyAllotment === "number" ? e.monthlyAllotment : 0),
              0,
            ) ?? 0
          const capacity = onboardingSavingsGoalCapacity(budget, restoredTotal)
          const defaultGoal = defaultOnboardingSavingsGoalAmount(capacity)
          setSavingsGoalAmount(defaultGoal)
          setSavingsGoalPct(
            capacity > 0
              ? onboardingSavingsGoalPercentOfCapacity(defaultGoal, capacity)
              : ONBOARDING_SAVINGS_GOAL_DEFAULT_PCT,
          )
        }
        if (typeof saved.savingsGoalPct === "number") {
          setSavingsGoalPct(saved.savingsGoalPct)
        }
        if (saved.envelopes?.length) {
          setEnvelopes(
            withoutSystemSavingsEnvelope(
              saved.envelopes.map((e: { id?: string; allocationCadence?: string; monthlyAllotment?: number; name?: string }) => {
                const raw = typeof e.monthlyAllotment === "number" ? e.monthlyAllotment : 0
                return {
                  ...e,
                  name: typeof e.name === "string" ? e.name : "",
                  id: typeof e.id === "string" && e.id.length > 0 ? e.id : undefined,
                  allocationCadence: e.allocationCadence ?? "monthly",
                  monthlyAllotment: Math.round(raw / 5) * 5,
                }
              }),
            ),
          )
        }
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
        incomeMode,
        cadence,
        payDays,
        payDayOfWeek,
        lastPaydayAt,
        estimatedAnnualIncome,
        allocPhase,
        savingsGoalAmount,
        savingsGoalPct,
        envelopes,
        pendingReferral,
      }))
    } catch { /* storage full or unavailable */ }
  }, [hydrated, step, income, incomeMode, cadence, payDays, payDayOfWeek, lastPaydayAt, estimatedAnnualIncome, allocPhase, savingsGoalAmount, savingsGoalPct, envelopes, pendingReferral])

  /** Drop system Savings if it leaked into draft state (server bootstrap or session restore). */
  useEffect(() => {
    if (!hydrated) return
    if (step !== "envelopes" && step !== "allocations") return
    setEnvelopes(prev => {
      const filtered = withoutSystemSavingsEnvelope(prev)
      return filtered.length === prev.length ? prev : filtered
    })
  }, [hydrated, step])

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
  async function redeemPendingReferralIfAny(): Promise<
    { ok: true } | { ok: false; message: string }
  > {
    const payload = referralPayloadForRedeem()
    if (!payload?.code) return { ok: true }
    try {
      const res = await fetch("/api/referral/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: payload.code,
          shareMethod: payload.shareMethod,
        }),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
      if (res.ok) {
        clearBitbudgetRefCookie()
        return { ok: true }
      }
      return { ok: false, message: referralRedeemErrorMessage(j) }
    } catch {
      return {
        ok: false,
        message: "We couldn't apply your referral code. Check your connection and try again.",
      }
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

  function skipOnboardingToComplete() {
    setImportDialogOpen(false)
    setStep("complete")
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
      const annualEstimate = parseFloat(estimatedAnnualIncome) || 0
      const regularMonthly =
        incomeMode !== "irregular"
          ? monthlyBudgetForAllocation(rawIncome, cadence)
          : 0
      const irregularMonthly =
        incomeMode === "irregular" || incomeMode === "mix"
          ? monthlyCapacityFromAnnualEstimate(annualEstimate)
          : 0
      const monthlyIncome = regularMonthly + irregularMonthly

      let payCadence: string = cadence
      if (incomeMode === "irregular") payCadence = "irregular"
      else if (incomeMode === "mix") payCadence = "mixed"

      const body: Record<string, unknown> = {
        monthlyIncome,
        payCadence,
        estimatedAnnualIncome:
          incomeMode === "irregular" || incomeMode === "mix"
            ? annualEstimate > 0
              ? annualEstimate
              : null
            : null,
      }

      if (incomeMode !== "irregular") {
        if (cadence === "monthly" || cadence === "bimonthly") {
          body.payDays = payDays
          body.payDayOfWeek = null
          body.lastPaydayAt = null
        } else {
          body.payDays = []
          body.payDayOfWeek = payDayOfWeek
          body.lastPaydayAt =
            cadence === "biweekly" && lastPaydayAt ? `${lastPaydayAt}T12:00:00.000Z` : null
        }
      } else {
        body.payDays = []
        body.payDayOfWeek = null
        body.lastPaydayAt = null
      }

      await fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
      deletedAt?: string | null
      systemRole: string | null
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
        deletedAt?: string | null
        systemRole: string | null
      }>
    } catch {
      return false
    }
    const active = all.filter(isOnboardingVisibleServerEnvelope)

    setEnvelopes(prev => {
      const seenIds = new Set<string>()
      const out: DraftEnvelope[] = []

      for (const p of prev) {
        if (!p.id || !isOnboardingDraftBudgetEnvelope(p)) continue
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
    let list = withoutSystemSavingsEnvelope(envelopes)
    if (newEnvName.trim()) {
      list = appendDraftEnvelope(list, newEnvName)
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
          const server = await res.json() as Array<{
            id: string
            name: string
            archived?: boolean
            deletedAt?: string | null
            systemRole?: string | null
          }>
          const byName = new Map<string, string>()
          for (const s of server) {
            if (!isOnboardingVisibleServerEnvelope(s)) continue
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
          systemRole?: string | null
        }>
      }
      const merged: DraftEnvelope[] = withoutSystemSavingsEnvelope(
        data.envelopes.map((se, i) => ({
          id: se.id,
          name: se.name,
          color: se.color,
          icon: listForSync[i]?.icon ?? se.icon ?? pickEnvelopeIconForName(se.name, []),
          monthlyAllotment: listForSync[i]?.monthlyAllotment ?? se.monthlyAllotment,
          allocationCadence: listForSync[i]?.allocationCadence ?? "monthly",
        })),
      )
      enterAllocations(merged)
    } finally {
      setLoading(false)
    }
  }

  async function saveEnvelopeAllocations(): Promise<boolean> {
    for (const env of envelopes) {
      if (!env.id || !isOnboardingDraftBudgetEnvelope(env)) continue
      const res = await fetch("/api/envelopes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: env.id,
          monthlyAllotment: env.monthlyAllotment,
        }),
      })
      if (!res.ok) return false
    }
    return true
  }

  async function handleBudgetAllocationsContinue() {
    setLoading(true)
    try {
      const ok = await saveEnvelopeAllocations()
      if (!ok) return
      const capacity = onboardingSavingsGoalCapacity(allocateMonthlyBudget, totalAllocated)
      const defaultGoal = defaultOnboardingSavingsGoalAmount(capacity)
      setSavingsGoalAmount(defaultGoal)
      setSavingsGoalPct(
        capacity > 0
          ? onboardingSavingsGoalPercentOfCapacity(defaultGoal, capacity)
          : ONBOARDING_SAVINGS_GOAL_DEFAULT_PCT,
      )
      setAllocPhase("savings-goal")
    } finally {
      setLoading(false)
    }
  }

  async function skipSavingsTracking() {
    setLoading(true)
    try {
      await fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          savingsExperience: SAVINGS_EXPERIENCE_DISMISSED,
          sweepDefaultPolicy: SWEEP_POLICY_CARRY_FORWARD,
        }),
      })
      setAllocPhase("budget")
      setStep(importResult !== null ? "complete" : "import")
    } finally {
      setLoading(false)
    }
  }

  async function handleSavingsGoalContinue() {
    setLoading(true)
    try {
      await fetch("/api/user/savings-goal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodKey: SAVINGS_GOAL_DEFAULT_PERIOD,
          targetAmount: savingsGoalAmount,
        }),
      })
      setAllocPhase("budget")
      setStep("savings-game-plan")
    } finally {
      setLoading(false)
    }
  }

  async function handleAllocationsSave() {
    if (allocPhase === "savings-goal") {
      await handleSavingsGoalContinue()
      return
    }
    await handleBudgetAllocationsContinue()
  }

  function handleImport() {
    if (!importFile) {
      setStep("complete")
      return
    }
    setImportDialogOpen(true)
  }


  async function handleComplete() {
    setCompleteFinishError(null)
    setSetupApiError(null)
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
        setSetupApiError("We couldn't finish setup. Please try again.")
        return
      }
      const hadReferralCode = !!referralPayloadForRedeem()?.code
      if (hadReferralCode) {
        const redeemResult = await redeemPendingReferralIfAny()
        if (!redeemResult.ok) {
          setCompleteFinishError(redeemResult.message)
          return
        }
        setReferralRedeemFlash({ type: "success", message: REFERRAL_REDEEM_SUCCESS_MESSAGE })
        setStep("referral-bank")
        return
      }
      finishOnboardingExit()
    } finally {
      setLoading(false)
    }
  }

  const totalAllocated = envelopes.reduce((s, e) => s + e.monthlyAllotment, 0)
  const allocateMonthlyBudget = useMemo(() => {
    const regular =
      incomeMode !== "irregular"
        ? monthlyBudgetForAllocation(parseFloat(income) || 0, cadence)
        : 0
    const irregular =
      incomeMode === "irregular" || incomeMode === "mix"
        ? monthlyCapacityFromAnnualEstimate(parseFloat(estimatedAnnualIncome) || 0)
        : 0
    return regular + irregular
  }, [incomeMode, income, cadence, estimatedAnnualIncome])
  const savingsGoalPaycheckPct = useMemo(() => {
    if (incomeMode === "irregular") return null
    return savingsGoalPercentOfPaycheck(savingsGoalAmount, parseFloat(income) || 0)
  }, [incomeMode, income, savingsGoalAmount])
  const savings = Math.max(0, allocateMonthlyBudget - totalAllocated)
  const unboundedAlloc = isUnboundedOnboardingAllocation(allocateMonthlyBudget)
  /** Live stack-bar / savings display while a slider is mid-drag (unbounded defers envelope commits). */
  const envelopeDisplayAllotments = useMemo((): number[] => {
    return envelopes.map((env, idx) => {
      if (allocSliderRawOverride?.idx !== idx) return env.monthlyAllotment
      const lockedGestureMax =
        unboundedAlloc && allocSliderLockedMax?.idx === idx
          ? allocSliderLockedMax.max
          : null
      const otherAllocated = envelopes.reduce(
        (s, e, j) => s + (j === idx ? 0 : e.monthlyAllotment),
        0,
      )
      const sliderMax =
        lockedGestureMax ??
        (unboundedAlloc
          ? unboundedOnboardingSliderVisitedMax(
              allocSliderUnboundedVisitedMax[idx],
              env.monthlyAllotment,
            )
          : onboardingSliderMaxForRow(
              env.monthlyAllotment,
              Math.max(0, allocateMonthlyBudget - otherAllocated),
              allocateMonthlyBudget,
            ))
      return onboardingOverrideDisplayAmount(
        allocSliderRawOverride.raw,
        sliderMax,
        allocSliderGestureKindRef.current === "fine" ? "fine" : "coarse",
      )
    })
  }, [
    allocateMonthlyBudget,
    allocSliderLockedMax,
    allocSliderRawOverride,
    allocSliderUnboundedVisitedMax,
    envelopes,
    unboundedAlloc,
  ])
  const totalAllocatedDisplay = envelopeDisplayAllotments.reduce((s, a) => s + a, 0)
  const showAllocStackBar = allocateMonthlyBudget > 0 || totalAllocatedDisplay > 0
  const allocStackBarTotal =
    allocateMonthlyBudget > 0 ? allocateMonthlyBudget : totalAllocatedDisplay
  const savingsDisplay = Math.max(0, allocateMonthlyBudget - totalAllocatedDisplay)
  const savingsPctDisplay =
    allocateMonthlyBudget > 0
      ? Math.round((savingsDisplay / allocateMonthlyBudget) * 100)
      : 0
  const savingsGoalCapacity = onboardingSavingsGoalCapacity(allocateMonthlyBudget, totalAllocated)
  const savingsGoalSliderMaxPct = useMemo(
    () =>
      onboardingSavingsGoalSliderMaxPct(
        savingsGoalPct,
        savingsGoalCapacity,
        savingsGoalAmount,
      ),
    [savingsGoalAmount, savingsGoalCapacity, savingsGoalPct],
  )

  /** Fit envelope totals when entering bounded allocation (e.g. unbounded → estimated income). */
  useEffect(() => {
    if (step !== "allocations") return
    if (isUnboundedOnboardingAllocation(allocateMonthlyBudget)) return

    let didScale = false
    setEnvelopes(prev => {
      const total = prev.reduce((s, e) => s + e.monthlyAllotment, 0)
      if (total <= allocateMonthlyBudget) return prev

      const scaled = scaleOnboardingAllocationsToBudget(
        prev.map(e => e.monthlyAllotment),
        allocateMonthlyBudget,
      )
      if (scaled.every((a, i) => a === prev[i].monthlyAllotment)) return prev
      didScale = true
      return prev.map((e, i) => ({ ...e, monthlyAllotment: scaled[i] }))
    })
    if (didScale) {
      syncAllocSliderRawOverride(null)
      setAllocSliderUnboundedVisitedMax({})
    }
  }, [step, allocateMonthlyBudget, syncAllocSliderRawOverride])

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
  const pendingDeleteTxTotal = pendingDeleteUsageReady ? (pendingDeleteUsage?.transactionTotalAmount ?? 0) : 0
  const pendingDeleteRec = pendingDeleteUsageReady ? (pendingDeleteUsage?.recurringCount ?? 0) : 0

  /**
   * Align committed allotment with the nearest $50 bucket for the current thumb position.
   * Usually a no-op during drag (bucket updates on midpoint crossings); used on release/blur to clamp.
   */
  const commitOnboardingSliderSnap = useCallback(
    (
      rowIdx: number,
      input: HTMLInputElement | null,
      pendingRaw?: number,
      snapStep: number = ONBOARDING_ALLOCATE_SLIDER_STEP,
    ) => {
      const parsed =
        pendingRaw != null && Number.isFinite(pendingRaw)
          ? pendingRaw
          : input
            ? parseInt(input.value, 10)
            : 0
      const v = Number.isFinite(parsed) ? parsed : 0
      const lockedMax =
        allocSliderDragSessionRef.current?.idx === rowIdx
          ? allocSliderDragSessionRef.current.lockedMax
          : allocSliderLockedMax?.idx === rowIdx
            ? allocSliderLockedMax.max
            : null
      setEnvelopes(prev => {
        const row = prev[rowIdx]
        if (!row) return prev
        const otherAllocated = prev.reduce((s, x, j) => s + (j === rowIdx ? 0 : x.monthlyAllotment), 0)
        const rowCap = onboardingAllocationCapForRow(allocateMonthlyBudget, otherAllocated)
        const snapMax = isUnboundedOnboardingAllocation(allocateMonthlyBudget)
          ? Math.max(
              lockedMax ??
                unboundedOnboardingSliderMaxForGestureWithVisited(
                  row.monthlyAllotment,
                  allocSliderUnboundedVisitedMax[rowIdx],
                ),
              unboundedOnboardingSliderVisitedMax(
                allocSliderUnboundedVisitedMax[rowIdx],
                row.monthlyAllotment,
              ),
            )
          : rowCap
        const snapped = snapOnboardingAllocationToStep(Math.min(snapMax, v), snapMax, snapStep)
        return prev.map((en, i) => (i === rowIdx ? { ...en, monthlyAllotment: snapped } : en))
      })
      syncAllocSliderRawOverride(prev => (prev?.idx === rowIdx ? null : prev))
      allocSliderPointerRef.current = null
      allocSliderGestureKindRef.current = null
      allocSliderDragSessionRef.current = null
      setAllocSliderLockedMax(prev => (prev?.idx === rowIdx ? null : prev))
    },
    [allocateMonthlyBudget, allocSliderLockedMax, allocSliderUnboundedVisitedMax, syncAllocSliderRawOverride],
  )

  const releaseAllocSliderRow = useCallback(
    (
      rowIdx: number,
      input: HTMLInputElement | null,
      unbounded: boolean,
    ) => {
      const session = allocSliderDragSessionRef.current
      const snapStep =
        allocSliderGestureKindRef.current === "fine"
          ? ONBOARDING_ALLOCATE_FINE_STEP
          : ONBOARDING_ALLOCATE_SLIDER_STEP
      const pendingRaw =
        allocSliderRawOverrideRef.current?.idx === rowIdx
          ? allocSliderRawOverrideRef.current.raw
          : undefined
      const lockedMax =
        session?.idx === rowIdx
          ? session.lockedMax
          : allocSliderLockedMax?.idx === rowIdx
            ? allocSliderLockedMax.max
            : null

      if (input || pendingRaw != null) {
        commitOnboardingSliderSnap(rowIdx, input, pendingRaw, snapStep)
      }

      if (unbounded && lockedMax != null) {
        bumpUnboundedSliderVisitedMaxForRow(rowIdx, lockedMax)
      }
    },
    [
      allocSliderLockedMax,
      bumpUnboundedSliderVisitedMaxForRow,
      commitOnboardingSliderSnap,
    ],
  )

  const beginAllocSliderGesture = useCallback(
    (rowIdx: number, initialRaw: number, gestureMax: number) => {
      if (isUnboundedOnboardingAllocation(allocateMonthlyBudget)) {
        allocSliderDragSessionRef.current = {
          idx: rowIdx,
          lockedMax: gestureMax,
          expandedFrom: new Set(),
        }
        setAllocSliderLockedMax({ idx: rowIdx, max: gestureMax })
      } else {
        allocSliderDragSessionRef.current = null
        setAllocSliderLockedMax(prev => (prev?.idx === rowIdx ? null : prev))
      }
      syncAllocSliderRawOverride({ idx: rowIdx, raw: initialRaw })
    },
    [allocateMonthlyBudget, syncAllocSliderRawOverride],
  )

  const applyOnboardingAllocSliderValue = useCallback(
    (
      rowIdx: number,
      parsedVal: number,
      ctx: {
        sliderMax: number
        committedAllotment: number
        isGestureActive: boolean
        commitNow: boolean
      },
    ) => {
      const session = allocSliderDragSessionRef.current
      const prevRaw = allocSliderRawForRow(rowIdx, ctx.committedAllotment)
      const isDraggingThisRow =
        ctx.isGestureActive || allocSliderPointerRef.current?.idx === rowIdx
      const activeMax =
        isUnboundedOnboardingAllocation(allocateMonthlyBudget) && session?.idx === rowIdx
          ? session.lockedMax
          : ctx.sliderMax

      let val = Math.max(0, parsedVal)

      if (
        isUnboundedOnboardingAllocation(allocateMonthlyBudget) &&
        isDraggingThisRow &&
        session?.idx === rowIdx
      ) {
        const drag = applyUnboundedOnboardingSliderDrag({
          prevRaw,
          val: parsedVal,
          activeMax,
          expandedFromMaxes: session.expandedFrom,
        })
        val = drag.val
        session.lockedMax = drag.activeMax
        session.expandedFrom = drag.expandedFromMaxes
        if (drag.didExpand) {
          setAllocSliderLockedMax({ idx: rowIdx, max: drag.activeMax })
          bumpUnboundedSliderVisitedMaxForRow(rowIdx, drag.activeMax)
        }
      } else {
        val = Math.min(activeMax, val)
      }

      if (isDraggingThisRow) {
        syncAllocSliderRawOverride({ idx: rowIdx, raw: val })
        if (!isUnboundedOnboardingAllocation(allocateMonthlyBudget)) {
          const newBucket = snapOnboardingAllocationToStep(val, activeMax)
          if (newBucket !== ctx.committedAllotment) {
            setEnvelopes(prev => prev.map((en, i) =>
              i === rowIdx ? { ...en, monthlyAllotment: newBucket } : en,
            ))
          }
        }
      } else if (ctx.commitNow) {
        const newBucket = snapOnboardingAllocationToStep(val, activeMax)
        if (newBucket !== ctx.committedAllotment) {
          setEnvelopes(prev => prev.map((en, i) =>
            i === rowIdx ? { ...en, monthlyAllotment: newBucket } : en,
          ))
        }
      }
    },
    [
      allocateMonthlyBudget,
      allocSliderRawForRow,
      bumpUnboundedSliderVisitedMaxForRow,
      syncAllocSliderRawOverride,
    ],
  )

  const nudgeAllocSliderRow = useCallback(
    (
      rowIdx: number,
      deltaSteps: number,
      ctx: { sliderMax: number; committedAllotment: number },
    ) => {
      const session = allocSliderDragSessionRef.current
      const prevRaw = allocSliderRawForRow(rowIdx, ctx.committedAllotment)
      const activeMax =
        isUnboundedOnboardingAllocation(allocateMonthlyBudget) && session?.idx === rowIdx
          ? session.lockedMax
          : ctx.sliderMax

      let parsedVal = nudgeOnboardingAllocationAmount(prevRaw, deltaSteps, activeMax)

      if (
        isUnboundedOnboardingAllocation(allocateMonthlyBudget) &&
        session?.idx === rowIdx &&
        deltaSteps > 0 &&
        parsedVal >= activeMax &&
        prevRaw >= activeMax - ONBOARDING_ALLOCATE_FINE_STEP
      ) {
        const drag = applyUnboundedOnboardingSliderDrag({
          prevRaw: Math.max(0, activeMax - ONBOARDING_ALLOCATE_FINE_STEP),
          val: activeMax,
          activeMax: session.lockedMax,
          expandedFromMaxes: session.expandedFrom,
        })
        session.lockedMax = drag.activeMax
        session.expandedFrom = drag.expandedFromMaxes
        if (drag.didExpand) {
          setAllocSliderLockedMax({ idx: rowIdx, max: drag.activeMax })
          bumpUnboundedSliderVisitedMaxForRow(rowIdx, drag.activeMax)
          parsedVal = nudgeOnboardingAllocationAmount(prevRaw, deltaSteps, drag.activeMax)
        }
      }

      applyOnboardingAllocSliderValue(rowIdx, parsedVal, {
        ...ctx,
        isGestureActive: true,
        commitNow: false,
      })
    },
    [
      allocateMonthlyBudget,
      allocSliderRawForRow,
      applyOnboardingAllocSliderValue,
      bumpUnboundedSliderVisitedMaxForRow,
    ],
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

        <div
          className={`bg-[#0D0D0D] rounded-2xl ${
            step === "allocations" && allocPhase === "budget" ? "p-2 sm:py-8 sm:p-8" : "py-8 px-4 sm:p-8"
          }`}
        >
          {restoredSession && !isNostr && step !== "referral" && step !== "security" && step !== "complete" && step !== "referral-bank" && (
            <div className="flex items-start gap-3 p-3 rounded-xl bg-[#3B82F6]/10 border border-[#3B82F6]/20 mb-6">
              <ShieldCheck className="h-5 w-5 text-[#3B82F6] shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                <p className="text-sm text-[#93C5FD] leading-snug">
                  Your progress was restored.
                  {hasExistingEncryption && bootstrapped
                    ? " Your account already has encryption — use Skip to jump to the final onboarding step, then continue to your dashboard."
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
                  {REFERRAL_VALIDATE_SUCCESS_HINT}{" "}
                  <span className="font-mono font-semibold">{pendingReferral.code}</span>
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
                        void (async () => {
                          setRefError(null)
                          setRefValidating(true)
                          try {
                            const r = await fetch(
                              `/api/referral/validate?code=${encodeURIComponent(refCodeInput.trim())}`,
                            )
                            const j = (await r.json()) as {
                              valid?: boolean
                              refereeTrialMonths?: 1 | 3
                              referrerOpportunityCostEnabled?: boolean
                            }
                            if (!j.valid) {
                              setRefError("It looks like that code is invalid, expired, or has already been used.")
                              return
                            }
                            const code = refCodeInput.trim()
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
                          } finally {
                            setRefValidating(false)
                          }
                        })()
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
                  onSkip={skipOnboardingToComplete}
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
                  onSkip={skipOnboardingToComplete}
                />
              </form>
            ) : null
          )}

          {/* Income Step */}
          {step === "income" && (
            <form
              onSubmit={e => {
                e.preventDefault()
                if (incomeMode === "irregular" || income) handleIncomeSave()
              }}
              className="flex flex-col gap-6"
            >
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-[#22C55E]/10">
                  <DollarSign className="h-6 w-6 text-[#22C55E]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Your income</h2>
                  <p className="text-sm text-muted-foreground">Tell us how money arrives — paydays grow Savings; envelopes refill on the 1st of each month</p>
                </div>
              </div>

              <div className="flex rounded-lg bg-[#1A1A1A] p-1">
                {(
                  [
                    { key: "regular" as const, label: "Regular paycheck" },
                    { key: "irregular" as const, label: "No regular income" },
                    { key: "mix" as const, label: "Mixed timing" },
                  ] as const
                ).map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={incomeMode === key}
                    onClick={() => setIncomeMode(key)}
                    className={`flex-1 py-2.5 px-2 text-xs sm:text-sm font-medium rounded-md transition-colors ${
                      incomeMode === key
                        ? "bg-[#F7931A] text-[#0D0D0D]"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-4">
                {(incomeMode === "regular" || incomeMode === "mix") && (
                  <>
                    <div className="flex flex-col gap-2">
                      <Label className="text-muted-foreground text-xs uppercase tracking-wider">
                        After-Tax Paycheck (USD)
                      </Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                        <Input
                          type="number"
                          value={income}
                          onChange={e => setIncome(e.target.value)}
                          placeholder="2,500"
                          className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555] pl-7 text-lg"
                          min="0"
                          step="any"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <Label className="text-muted-foreground text-xs uppercase tracking-wider">Pay frequency</Label>
                      <div className="grid grid-cols-2 gap-1 rounded-lg bg-[#1A1A1A] p-1">
                        {(
                          [
                            { key: "monthly" as const, label: "Monthly" },
                            { key: "bimonthly" as const, label: "Bi-monthly" },
                            { key: "weekly" as const, label: "Weekly" },
                            { key: "biweekly" as const, label: "Bi-weekly" },
                          ] as const
                        ).map(({ key, label }) => (
                          <button
                            key={key}
                            type="button"
                            aria-pressed={cadence === key}
                            onClick={() => {
                              setCadence(key)
                              if (key === "bimonthly" && payDays.length < 2) {
                                setPayDays(prev => (prev.length >= 2 ? prev : [prev[0] ?? 1, 16]))
                              }
                            }}
                            className={`py-2.5 text-sm font-medium rounded-md transition-colors ${
                              cadence === key
                                ? "bg-[#F7931A] text-[#0D0D0D]"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {(cadence === "monthly" || cadence === "bimonthly") && (
                      <div className="flex flex-col gap-2">
                        <Label className="text-muted-foreground text-xs uppercase tracking-wider">
                          {cadence === "monthly" ? "Pay day of month" : "Pay days of month"}
                        </Label>
                        <div className="flex flex-wrap gap-2">
                          {(cadence === "monthly" ? [0] : [0, 1]).map(slot => (
                            <select
                              key={slot}
                              value={payDays[slot] ?? (slot === 0 ? 1 : 15)}
                              onChange={e => {
                                const val = Number(e.target.value)
                                setPayDays(prev => {
                                  const next = [...prev]
                                  next[slot] = val
                                  return next
                                })
                              }}
                              className="bg-[#1A1A1A] border border-[#333] rounded-lg px-3 py-2 text-sm text-foreground"
                              aria-label={cadence === "monthly" ? "Pay day of month" : `Pay day ${slot + 1}`}
                            >
                              {PAYDAY_DOM_OPTIONS.map(day => (
                                <option key={day} value={day}>
                                  {day === PAYDAY_LAST_OF_MONTH ? "Last day" : `${day}${day === 1 ? "st" : day === 2 ? "nd" : day === 3 ? "rd" : "th"}`}
                                </option>
                              ))}
                            </select>
                          ))}
                        </div>
                      </div>
                    )}

                    {(cadence === "weekly" || cadence === "biweekly") && (
                      <>
                        <div className="flex flex-col gap-2">
                          <Label className="text-muted-foreground text-xs uppercase tracking-wider">Pay day of week</Label>
                          <div className="flex flex-wrap gap-1">
                            {WEEKDAY_OPTIONS.map(({ value, label }) => (
                              <button
                                key={value}
                                type="button"
                                aria-pressed={payDayOfWeek === value}
                                onClick={() => setPayDayOfWeek(value)}
                                className={`px-3 py-2 text-xs font-medium rounded-md transition-colors ${
                                  payDayOfWeek === value
                                    ? "bg-[#F7931A] text-[#0D0D0D]"
                                    : "bg-[#1A1A1A] text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        {cadence === "biweekly" && (
                          <div className="flex flex-col gap-2">
                            <Label className="text-muted-foreground text-xs uppercase tracking-wider">
                              Most recent payday
                            </Label>
                            <Input
                              type="date"
                              value={lastPaydayAt}
                              onChange={e => setLastPaydayAt(e.target.value)}
                              className="bg-[#1A1A1A] border-[#333] text-foreground"
                            />
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}

                {(incomeMode === "irregular" || incomeMode === "mix") && (
                  <div className="flex flex-col gap-2">
                    {incomeMode === "irregular" && (
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        No regular paycheck? No problem — we&apos;ll learn your rhythm as transactions come in.
                      </p>
                    )}
                    <Label className="text-muted-foreground text-xs uppercase tracking-wider">
                      Estimated annual income (optional)
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                      <Input
                        type="number"
                        value={estimatedAnnualIncome}
                        onChange={e => setEstimatedAnnualIncome(e.target.value)}
                        placeholder="60,000"
                        className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555] pl-7"
                        min="0"
                        step="any"
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      We will use this to help build a rough budget for you. You can leave this blank if you are not sure.
                    </p>
                  </div>
                )}
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
                  disabled={loading || (incomeMode !== "irregular" && !income)}
                  className="flex-1 py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? "Saving..." : "Continue"}
                  {!loading && <ChevronRight className="h-4 w-4" aria-hidden />}
                </button>
              </div>
              <OnboardingSkipBar
                show={canSkipOnboarding && bootstrapped}
                disabled={loading}
                onSkip={skipOnboardingToComplete}
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
                  <p className="text-sm text-muted-foreground">These are your spending categories. Add as many or as few as you like - but we recommend not having more than 10 to 12.</p>
                </div>
              </div>

              <OnboardingDismissibleHint
                hintId={ONBOARDING_HINT_ENVELOPES}
                dismissed={dismissedOnboardingHints.has(ONBOARDING_HINT_ENVELOPES)}
                onDismiss={dismissOnboardingHint}
                className="border border-[#252525] bg-[#1A1A1A]/60"
              >
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Add envelopes for each area you spend money on. Don&apos;t worry about amounts yet — the next step lets you allocate your income across these envelopes.
                </p>
              </OnboardingDismissibleHint>

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
                                if (!t || duplicate || !isOnboardingDraftBudgetEnvelope({ name: t })) {
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
                onSkip={skipOnboardingToComplete}
              />
            </form>
          )}

          {/* Allocations Step */}
          {step === "allocations" && (
            <form onSubmit={e => { e.preventDefault(); handleAllocationsSave() }} className="flex min-w-0 flex-col gap-6">
              <style>{`
                input[type="range"].alloc-slider {
                  -webkit-appearance: none;
                  appearance: none;
                  width: 100%;
                  height: 6px;
                  border-radius: 3px;
                  outline: none;
                  cursor: pointer;
                  touch-action: pan-x;
                  padding: 0;
                  margin: 0;
                  background: transparent;
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

              {allocPhase === "savings-goal" ? (
                <>
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl" style={{ backgroundColor: `${SAVINGS_GOLD_ACCENT}22` }}>
                      <Target className="h-6 w-6" style={{ color: SAVINGS_GOLD_ACCENT }} />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-foreground">Your savings goal</h2>
                      <p className="text-sm text-muted-foreground">
                        Pay yourself first. Let&apos;s set your first monthly savings goal.
                      </p>
                    </div>
                  </div>

                  <OnboardingDismissibleHint
                    hintId={ONBOARDING_HINT_SAVINGS_GOAL}
                    dismissed={dismissedOnboardingHints.has(ONBOARDING_HINT_SAVINGS_GOAL)}
                    onDismiss={dismissOnboardingHint}
                    className="border bg-transparent"
                    style={{
                      borderColor: `${SAVINGS_GOLD_ACCENT}44`,
                      backgroundColor: `${SAVINGS_GOLD_ACCENT}14`,
                    }}
                  >
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      BitBudget maintains a continuous ledger to help you budget. Your income goes directly 
                      into Savings, and then Savings is drawn down each month to fill your
                      budget envelopes.
                    </p>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Pick a ballpark target for now. You can adjust it anytime as your budget takes shape.
                    </p>
                  </OnboardingDismissibleHint>

                  {!unboundedAlloc && allocateMonthlyBudget > 0 && (
                    <div className="rounded-xl border border-[#252525] bg-[#1A1A1A] px-4 py-3 flex flex-col gap-2">
                      <div className="flex items-baseline justify-between gap-4">
                        <span className="text-xs text-muted-foreground">Your income</span>
                        <span className="text-sm font-semibold text-foreground tabular-nums">
                          ${Math.round(allocateMonthlyBudget).toLocaleString()}<span className="text-xs font-normal text-muted-foreground">/mo</span>
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between gap-4">
                        <span className="text-xs text-muted-foreground">Your estimated expenses</span>
                        <span className="text-sm text-muted-foreground tabular-nums">
                          − ${Math.round(totalAllocated).toLocaleString()}<span className="text-xs">/mo</span>
                        </span>
                      </div>
                      <div
                        className="border-t pt-2 mt-0.5 flex items-center justify-between gap-3"
                        style={{ borderColor: `${SAVINGS_GOLD_ACCENT}44` }}
                      >
                        <div className="flex items-center gap-1.5">
                          <PiggyBank className="h-4 w-4" style={{ color: SAVINGS_GOLD_ACCENT }} />
                          <span className="text-sm font-semibold" style={{ color: SAVINGS_GOLD_ACCENT }}>Savings</span>
                        </div>
                        <span className="text-lg font-bold tabular-nums" style={{ color: SAVINGS_GOLD_ACCENT }}>
                          ${Math.round(savings).toLocaleString()}<span className="text-sm font-normal text-muted-foreground">/mo</span>
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="rounded-xl border border-[#252525] bg-[#1A1A1A] p-5 flex flex-col gap-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm text-muted-foreground">Target</span>
                      <span className="text-2xl font-semibold" style={{ color: SAVINGS_GOLD_ACCENT }}>
                        ${savingsGoalAmount.toLocaleString()}/mo
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={savingsGoalSliderMaxPct}
                      step={1}
                      value={savingsGoalPct}
                      aria-label={
                        unboundedAlloc
                          ? "Savings goal percentage of estimated monthly spend"
                          : "Savings goal percentage of monthly income"
                      }
                      onChange={e => {
                        const pct = Number(e.target.value)
                        setSavingsGoalPct(pct)
                        setSavingsGoalAmount(
                          onboardingSavingsGoalAmountFromPercent(savingsGoalCapacity, pct),
                        )
                      }}
                      className="w-full accent-[#D4AF37]"
                    />
                    <div className="flex flex-col gap-0.5 text-center">
                      {savingsGoalCapacity > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {unboundedAlloc
                            ? `${savingsGoalPct}% of estimated monthly spend`
                            : `${savingsGoalPct}% of monthly capacity`}
                        </p>
                      )}
                      {savingsGoalPaycheckPct != null && (
                        <p className="text-xs text-muted-foreground">
                          {savingsGoalPaycheckPct}% of each paycheck
                        </p>
                      )}
                    </div>
                    <div className="flex items-center justify-center gap-1.5 pt-1">
                      <label htmlFor="onboarding-savings-goal-amount" className="sr-only">
                        Monthly savings goal amount
                      </label>
                      <span className="text-xs text-muted-foreground">$</span>
                      <input
                        id="onboarding-savings-goal-amount"
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        value={savingsGoalAmount > 0 ? String(Math.round(savingsGoalAmount)) : ""}
                        onChange={e => {
                          const monthly = monthlyFromDigitOnlyInput(
                            e.target.value,
                            "monthly",
                            ONBOARDING_UNBOUNDED_INPUT_MAX,
                          )
                          const { amount, pct } = onboardingSavingsGoalFromManualInput(
                            monthly,
                            savingsGoalCapacity,
                          )
                          setSavingsGoalAmount(amount)
                          setSavingsGoalPct(pct)
                        }}
                        placeholder="0"
                        className="w-28 bg-transparent border-b border-[#333] text-center text-foreground text-sm font-semibold py-0.5 focus:outline-none focus:border-[#D4AF37] transition-colors"
                      />
                      <span className="text-xs text-muted-foreground">/mo</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void skipSavingsTracking()}
                    className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 mx-auto"
                  >
                    Not for me — I&apos;ll stick to my budget
                  </button>

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setAllocPhase("budget")}
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
                </>
              ) : (
                <>
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-[#3B82F6]/10">
                  <PieChart className="h-6 w-6 text-[#3B82F6]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Your budget</h2>
                  <p className="text-sm text-muted-foreground">
                      What would you estimate you spend in each of these categories each month?
                  </p>
                </div>
              </div>

              {/* Stacked bar + sliders — scrollable on small screens so Continue stays reachable */}
              <div className="flex min-w-0 flex-col max-md:max-h-[calc(100dvh-13rem)] max-md:space-y-4 max-md:overflow-x-hidden max-md:overflow-y-scroll max-md:overscroll-y-contain max-md:touch-pan-y max-md:[-webkit-overflow-scrolling:touch]">
              {showAllocStackBar && (
                <div
                  className="sticky top-0 z-20 max-md:mx-0 max-md:px-0 -mx-8 px-8 py-3 -mt-2 mb-2 bg-[#0D0D0D] border-b border-[#1F1F1F] shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
                >
                  <div className="flex flex-col gap-2">
                  <div className="flex h-10 w-full flex-row rounded-xl overflow-hidden bg-[#1A1A1A]">
                    {envelopes.map((env, idx) => {
                      const displayAllotment = envelopeDisplayAllotments[idx] ?? 0
                      if (displayAllotment <= 0) return null
                      const pct =
                        allocStackBarTotal > 0
                          ? (displayAllotment / allocStackBarTotal) * 100
                          : 0
                      const amt = Math.round(displayAllotment)
                      const sharePct =
                        unboundedAlloc && totalAllocatedDisplay > 0
                          ? Math.round((displayAllotment / totalAllocatedDisplay) * 100)
                          : Math.round(pct)
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
                              <span className="text-muted-foreground/80"> · {sharePct}%</span>
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      )
                    })}
                    {!unboundedAlloc && savingsDisplay > 0 && (
                      <Tooltip delayDuration={200}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="flex min-w-0 shrink-0 items-center justify-center cursor-default box-border"
                            style={{
                              width: `${(savingsDisplay / allocateMonthlyBudget) * 100}%`,
                              minWidth: 4,
                              backgroundColor: "rgba(34, 197, 94, 0.25)",
                              transition: ALLOC_STACK_BAR_WIDTH_TRANSITION,
                            }}
                            aria-label={`Savings, $${Math.round(savingsDisplay).toLocaleString()} per month, ${savingsPctDisplay}% of budget`}
                          >
                            {savingsPctDisplay > 8 && <PiggyBank className="h-4 w-4 text-[#22C55E]/60" />}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          sideOffset={6}
                          className="max-w-[min(100vw-2rem,16rem)] border border-[#333] bg-[#1A1A1A] px-3 py-2 text-foreground shadow-xl [&>svg]:hidden"
                        >
                          <p className="text-sm font-semibold leading-tight">Savings</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            ${Math.round(savingsDisplay).toLocaleString()}/mo unallocated
                            <span className="text-muted-foreground/80"> · {savingsPctDisplay}%</span>
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground px-1 transition-[color] duration-300">
                    {unboundedAlloc ? (
                      <span className="tabular-nums mx-auto">
                        ${totalAllocatedDisplay.toLocaleString()} estimated monthly spend
                      </span>
                    ) : (
                      <>
                        <span className="tabular-nums">
                          ${totalAllocatedDisplay.toLocaleString()} allocated
                        </span>
                        <span className="tabular-nums">
                          ${allocateMonthlyBudget.toLocaleString()} monthly budget
                        </span>
                      </>
                    )}
                  </div>
                  </div>
                </div>
              )}

              {/* Per-envelope slider rows — space-y (not gap) so iOS can scroll between rows */}
              <div className="flex min-w-0 flex-col max-md:space-y-4">
                {envelopes.map((env, idx) => {
                  const lockedGestureMax =
                    unboundedAlloc && allocSliderLockedMax?.idx === idx
                      ? allocSliderLockedMax.max
                      : null
                  const sliderMax =
                    lockedGestureMax ??
                    (unboundedAlloc
                      ? unboundedOnboardingSliderVisitedMax(
                          allocSliderUnboundedVisitedMax[idx],
                          env.monthlyAllotment,
                        )
                      : onboardingSliderMaxForRow(
                          env.monthlyAllotment,
                          savings,
                          allocateMonthlyBudget,
                        ))
                  const rowCap = onboardingAllocationCapForRow(
                    allocateMonthlyBudget,
                    totalAllocated - env.monthlyAllotment,
                  )
                  const sliderVisualRaw =
                    allocSliderRawOverride?.idx === idx
                      ? allocSliderRawOverride.raw
                      : env.monthlyAllotment
                  const rowAllotmentForDisplay =
                    allocSliderRawOverride?.idx === idx
                      ? onboardingOverrideDisplayAmount(
                          allocSliderRawOverride.raw,
                          sliderMax,
                          allocSliderGestureKindRef.current === "fine" ? "fine" : "coarse",
                        )
                      : env.monthlyAllotment
                  const pct =
                    allocateMonthlyBudget > 0
                      ? Math.round((rowAllotmentForDisplay / allocateMonthlyBudget) * 100)
                      : 0
                  const sliderValueClamped =
                    sliderMax <= 0
                      ? 0
                      : Math.min(sliderMax, Math.max(0, Math.round(sliderVisualRaw)))
                  const dragSession =
                    allocSliderDragSessionRef.current?.idx === idx
                      ? allocSliderDragSessionRef.current
                      : null
                  const isPinnedAtExpandedCeiling =
                    isUnboundedOnboardingAllocation(allocateMonthlyBudget) &&
                    allocSliderRawOverride?.idx === idx &&
                    dragSession != null &&
                    dragSession.expandedFrom.has(sliderValueClamped) &&
                    sliderValueClamped < sliderMax
                  const rangeInputValue = isPinnedAtExpandedCeiling
                    ? sliderMax
                    : sliderValueClamped
                  const sliderPct =
                    isUnboundedOnboardingAllocation(allocateMonthlyBudget) &&
                    allocSliderRawOverride?.idx === idx
                      ? unboundedOnboardingSliderThumbPct(
                          sliderValueClamped,
                          sliderMax,
                          dragSession?.expandedFrom,
                        )
                      : sliderMax > 0
                        ? (sliderValueClamped / sliderMax) * 100
                        : 0

                  return (
                    <div
                      key={idx}
                      ref={el => { sliderRowRefs.current[idx] = el }}
                      className={`flex min-w-0 flex-col gap-2 p-3 rounded-xl transition-colors max-md:pointer-events-none ${
                        activeEnvIdx === idx ? "bg-[#1A1A1A]" : "bg-transparent"
                      }`}
                      onClick={() => setActiveEnvIdx(idx)}
                    >
                      {/* Narrow screens: title row so name isn&apos;t squeezed out by amount controls */}
                      <p className="sm:hidden text-xs font-semibold text-foreground leading-snug truncate max-md:pointer-events-auto">
                        {env.name}
                      </p>
                      <div className="flex min-w-0 items-center gap-3 max-md:pointer-events-auto">
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
                              rowAllotmentForDisplay,
                              env.allocationCadence ?? "monthly",
                            )}
                            onChange={e => {
                              syncAllocSliderRawOverride(prev =>
                                prev?.idx === idx ? null : prev,
                              )
                              clearUnboundedSliderVisitedMaxForRow(idx)
                              const cadence = (env.allocationCadence ?? "monthly") as AllocationCadence
                              const monthly = monthlyFromDigitOnlyInput(e.target.value, cadence, rowCap)
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
                              syncAllocSliderRawOverride(prev =>
                                prev?.idx === idx ? null : prev,
                              )
                              clearUnboundedSliderVisitedMaxForRow(idx)
                              setEnvelopes(prev => prev.map((en, i) => {
                                if (i !== idx) return en
                                const oldCadence = en.allocationCadence ?? "monthly"
                                // Keep the dollar amount in the text field; re-derive monthly from that figure + new cadence.
                                const displayAmount = fromMonthly(en.monthlyAllotment, oldCadence)
                                let newMonthly = toMonthly(displayAmount, newCadence)
                                const rowTotal = prev.reduce((s, x) => s + x.monthlyAllotment, 0)
                                const otherAllocated = rowTotal - en.monthlyAllotment
                                const maxMonthly = onboardingAllocationCapForRow(
                                  allocateMonthlyBudget,
                                  otherAllocated,
                                )
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

                      <div className="flex min-w-0 items-center gap-2 max-md:pointer-events-auto">
                      <div className="relative flex h-8 min-w-0 flex-1 items-center overflow-hidden">
                      <input
                        type="range"
                        ref={el => { allocSliderRangeInputRefs.current[idx] = el }}
                        className="alloc-slider min-w-0 flex-1"
                        min={0}
                        max={Math.max(0, sliderMax)}
                        step={1}
                        value={rangeInputValue}
                        aria-label={`${env.name} monthly allotment`}
                        onChange={e => {
                          const rawParsed = parseInt(e.target.value, 10)
                          const parsedVal = Number.isFinite(rawParsed) ? Math.max(0, rawParsed) : 0
                          applyOnboardingAllocSliderValue(idx, parsedVal, {
                            sliderMax,
                            committedAllotment: env.monthlyAllotment,
                            isGestureActive: allocSliderPointerRef.current?.idx === idx,
                            commitNow: allocSliderPointerRef.current?.idx !== idx,
                          })
                        }}
                        onPointerDown={e => {
                          const gestureMax = unboundedAlloc
                            ? unboundedOnboardingSliderMaxForGestureWithVisited(
                                env.monthlyAllotment,
                                allocSliderUnboundedVisitedMax[idx],
                              )
                            : onboardingSliderMaxForRow(
                                env.monthlyAllotment,
                                savings,
                                allocateMonthlyBudget,
                              )
                          const rawInit = parseInt(e.currentTarget.value, 10)
                          const init = Number.isFinite(rawInit)
                            ? Math.min(gestureMax, Math.max(0, rawInit))
                            : 0
                          allocSliderPendingPointerRef.current = {
                            pointerId: e.pointerId,
                            idx,
                            startX: e.clientX,
                            startY: e.clientY,
                            gestureMax,
                            init,
                            committed: false,
                          }
                        }}
                        onPointerMove={e => {
                          const pending = allocSliderPendingPointerRef.current
                          if (!pending || pending.pointerId !== e.pointerId || pending.idx !== idx) return
                          if (pending.committed) return

                          const dx = e.clientX - pending.startX
                          const dy = e.clientY - pending.startY
                          if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
                            allocSliderPendingPointerRef.current = null
                            return
                          }
                          if (Math.abs(dx) <= Math.abs(dy) || Math.abs(dx) <= 8) return

                          pending.committed = true
                          const currentNativeRaw = parseInt(e.currentTarget.value, 10)
                          const currentInit = Number.isFinite(currentNativeRaw)
                            ? Math.min(pending.gestureMax, Math.max(0, currentNativeRaw))
                            : pending.init
                          beginAllocSliderGesture(idx, currentInit, pending.gestureMax)
                          allocSliderGestureKindRef.current = "coarse"
                          allocSliderPointerRef.current = { pointerId: e.pointerId, idx }
                        }}
                        onPointerUp={e => {
                          const pending = allocSliderPendingPointerRef.current
                          if (
                            pending?.pointerId === e.pointerId &&
                            pending.idx === idx &&
                            !pending.committed
                          ) {
                            allocSliderPendingPointerRef.current = null
                            return
                          }
                          allocSliderPendingPointerRef.current = null
                          if (allocSliderPointerRef.current?.pointerId !== e.pointerId) return
                          try {
                            e.currentTarget.releasePointerCapture(e.pointerId)
                          } catch {
                            /* noop */
                          }
                          releaseAllocSliderRow(idx, e.currentTarget, unboundedAlloc)
                          allocSliderSkipBlurCommitRef.current = idx
                        }}
                        onPointerCancel={e => {
                          const pending = allocSliderPendingPointerRef.current
                          if (
                            pending?.pointerId === e.pointerId &&
                            pending.idx === idx &&
                            !pending.committed
                          ) {
                            allocSliderPendingPointerRef.current = null
                            return
                          }
                          allocSliderPendingPointerRef.current = null
                          if (allocSliderPointerRef.current?.pointerId !== e.pointerId) return
                          try {
                            e.currentTarget.releasePointerCapture(e.pointerId)
                          } catch {
                            /* noop */
                          }
                          releaseAllocSliderRow(idx, e.currentTarget, unboundedAlloc)
                          allocSliderSkipBlurCommitRef.current = idx
                        }}
                        onBlur={e => {
                          if (allocSliderSkipBlurCommitRef.current === idx) {
                            allocSliderSkipBlurCommitRef.current = null
                            return
                          }
                          commitOnboardingSliderSnap(idx, e.currentTarget)
                        }}
                        onFocus={() => setActiveEnvIdx(idx)}
                        style={{
                          "--slider-color": env.color,
                          "--slider-pct": `${sliderPct}%`,
                        } as React.CSSProperties}
                      />
                      </div>
                      <OnboardingAllocFineScroller
                        accentColor={env.color}
                        ariaLabel={`Fine adjust ${env.name} monthly allotment`}
                        value={env.monthlyAllotment}
                        maxValue={sliderMax}
                        onGestureStart={() => {
                          setActiveEnvIdx(idx)
                          allocSliderGestureKindRef.current = "fine"
                          const gestureMax = unboundedAlloc
                            ? unboundedOnboardingSliderMaxForGestureWithVisited(
                                env.monthlyAllotment,
                                allocSliderUnboundedVisitedMax[idx],
                              )
                            : onboardingSliderMaxForRow(
                                env.monthlyAllotment,
                                savings,
                                allocateMonthlyBudget,
                              )
                          const currentRaw = allocSliderRawForRow(idx, env.monthlyAllotment)
                          beginAllocSliderGesture(
                            idx,
                            Math.min(gestureMax, Math.max(0, currentRaw)),
                            gestureMax,
                          )
                        }}
                        onNudge={deltaSteps => {
                          nudgeAllocSliderRow(idx, deltaSteps, {
                            sliderMax,
                            committedAllotment: env.monthlyAllotment,
                          })
                        }}
                        onGestureEnd={() => {
                          releaseAllocSliderRow(
                            idx,
                            allocSliderRangeInputRefs.current[idx],
                            unboundedAlloc,
                          )
                        }}
                      />
                      </div>
                      {env.allocationCadence !== "monthly" && rowAllotmentForDisplay > 0 && (
                        <span className="text-[10px] text-muted-foreground mt-0.5">
                          = ${Math.round(rowAllotmentForDisplay).toLocaleString()}/mo
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>

              {!unboundedAlloc && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-[#1A1A1A]/60 border border-[#1F1F1F]">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-[#22C55E]/10">
                  <PiggyBank className="h-4 w-4 text-[#22C55E]" />
                </div>
                <span className="flex-1 text-sm font-medium text-muted-foreground">Savings</span>
                <div className="flex items-baseline gap-1.5 shrink-0">
                  <span className="text-sm font-semibold text-[#22C55E]">${savingsDisplay.toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground w-10 text-right">{savingsPctDisplay}%</span>
                </div>
              </div>
              )}

              {savingsDisplay === 0 && totalAllocatedDisplay > 0 && !unboundedAlloc && (
                <p className="text-xs text-amber-400/80 text-center">All income allocated — nothing goes to savings</p>
              )}
              </div>

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
                </>
              )}
              <OnboardingSkipBar
                show={canSkipOnboarding && bootstrapped}
                disabled={loading}
                onSkip={skipOnboardingToComplete}
              />
            </form>
          )}

          {/* Savings game plan affirmation */}
          {step === "savings-game-plan" && (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col items-center text-center gap-3 py-2">
                <div className="p-4 rounded-full" style={{ backgroundColor: `${SAVINGS_GOLD_ACCENT}18` }}>
                  <PiggyBank className="h-10 w-10" style={{ color: SAVINGS_GOLD_ACCENT }} />
                </div>
                <h2 className="text-2xl font-bold text-foreground">Your Savings game plan</h2>
                <p className="text-3xl font-semibold text-foreground">
                  You&apos;ll save{" "}
                  <span style={{ color: SAVINGS_GOLD_ACCENT }}>
                    ${Math.max(savingsGoalAmount, savings).toLocaleString()}
                  </span>
                  /month.
                </p>
                <p className="text-sm text-muted-foreground max-w-sm">
                  In a year, that&apos;s{" "}
                  <span className="text-foreground font-medium">
                    ${(Math.max(savingsGoalAmount, savings) * 12).toLocaleString()}
                  </span>
                  {onboardingSource === "btc" && " — every dollar saved is a vote for your future."}
                </p>
                <p className="text-sm text-muted-foreground italic">Your future self thanks you.</p>
              </div>

              <OnboardingDismissibleHint
                hintId={ONBOARDING_HINT_SAVINGS_SWEEP}
                dismissed={dismissedOnboardingHints.has(ONBOARDING_HINT_SAVINGS_SWEEP)}
                onDismiss={dismissOnboardingHint}
                className="border border-[#252525] bg-[#1A1A1A]/60"
              >
                <p className="text-xs text-muted-foreground text-center leading-relaxed">
                  We&apos;ll sweep leftover envelope balances to Savings on the 1st of each month — you can change this in Settings anytime.
                </p>
              </OnboardingDismissibleHint>

              <button
                type="button"
                disabled={loading}
                onClick={() => setStep(importResult !== null ? "complete" : "import")}
                className="w-full py-3 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                Continue
                <ChevronRight className="h-4 w-4" />
              </button>
              <OnboardingSkipBar
                show={canSkipOnboarding && bootstrapped}
                disabled={loading}
                onSkip={skipOnboardingToComplete}
              />
            </div>
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
                  onClick={() => setStep("savings-game-plan")}
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
                onSkip={skipOnboardingToComplete}
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
              {setupApiError ? (
                <div
                  role="alert"
                  className="w-full rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 text-left"
                >
                  {setupApiError}
                </div>
              ) : null}
              {completeFinishError ? (
                <div
                  role="alert"
                  className="w-full rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 space-y-2 text-left"
                >
                  <p className="font-medium text-red-200">Referral code couldn&apos;t be applied</p>
                  <p>{completeFinishError}</p>
                  <p className="text-xs text-red-300/90">
                    Go <strong className="text-red-200">Back</strong> to check the code, or apply it later under{" "}
                    <strong className="text-red-200">Settings → Referrals</strong> (within 7 days of finishing setup).
                  </p>
                </div>
              ) : null}
              {refereeTrialExplainerOnComplete ? (
                <OnboardingDismissibleHint
                  hintId={ONBOARDING_HINT_REFERRAL_COMPLETE}
                  dismissed={dismissedOnboardingHints.has(ONBOARDING_HINT_REFERRAL_COMPLETE)}
                  onDismiss={dismissOnboardingHint}
                  className="w-full text-left"
                >
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
                </OnboardingDismissibleHint>
              ) : (
                <p className="text-xs text-muted-foreground text-center max-w-sm">
                  Invited by a friend? Use <strong className="text-foreground">Back</strong> to the referral step or open their invite link in
                  this browser before you continue so your trial can apply.
                </p>
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
              <div className="rounded-xl border border-[#22C55E]/30 bg-[#22C55E]/10 px-4 py-3 flex items-start gap-3">
                <Gift className="h-5 w-5 text-[#22C55E] shrink-0 mt-0.5" aria-hidden />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-[#86EFAC]">Referral code applied!</p>
                  <p className="text-sm text-[#BBF7D0]/90">{REFERRAL_REDEEM_SUCCESS_MESSAGE}</p>
                </div>
              </div>
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
              <OnboardingDismissibleHint
                hintId={ONBOARDING_HINT_REFERRAL_BANK}
                dismissed={dismissedOnboardingHints.has(ONBOARDING_HINT_REFERRAL_BANK)}
                onDismiss={dismissOnboardingHint}
              >
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
              </OnboardingDismissibleHint>
              <PlaidConnectionsSection canConnect connectAlign="center" />
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
                      We couldn&apos;t load usage for this envelope yet. Removing it may delete
                      associated transactions and recurring rules from your budget. Try loading usage
                      again, or cancel and continue once your connection is stable.
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
                    This envelope will be removed from your list. You can add it again before you
                    continue, or restore it from Envelopes for {ENVELOPE_DELETE_GRACE_DAYS} days after
                    setup.
                  </p>
                ) : (
                  <p>
                    This will remove{" "}
                    <span className="font-medium text-foreground">{pendingDeleteEnv.name}</span> and
                    delete{" "}
                    {[
                      pendingDeleteTxs > 0
                        ? `${pendingDeleteTxs} transaction${pendingDeleteTxs === 1 ? "" : "s"} totaling ${formatUsd(pendingDeleteTxTotal)}`
                        : null,
                      pendingDeleteRec > 0
                        ? `${pendingDeleteRec} recurring rule${pendingDeleteRec === 1 ? "" : "s"}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" and ")}{" "}
                    from your budget. You can restore it from Envelopes for {ENVELOPE_DELETE_GRACE_DAYS}{" "}
                    days after you finish setup.
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
