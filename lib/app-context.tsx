"use client"

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react"
import { signOut } from "next-auth/react"
import type {
  Transaction,
  Envelope,
  AppState,
  BtcDisplayUnit,
  PendingTransaction,
  Tag,
  RecurringTransaction,
  CommunicationPreferenceKey,
} from "@/lib/data"
import type { ParsedTransaction } from "@/lib/csv"
import type { FoldStatementMeta } from "@/lib/fold-pdf-parser"
import {
  applyServerTransactionAfterOptimisticCreate,
  compareTransactionsDesc,
  generateId,
  getDefaultState,
  transactionsAfterFullServerSync,
} from "@/lib/data"
import type { ReceiptScanStats } from "@/lib/receipt-scan-validate"
import { SYSTEM_ENVELOPE_ROLE_SAVINGS } from "@/lib/constants"
import { shouldCascadeDeleteTransactionBatch } from "@/lib/transaction-batch-delete"
import {
  COMMUNICATION_PREFERENCE_COLUMNS,
  normalizeCommunicationPreferences,
} from "@/lib/communication-preferences"
import {
  parsePremiumRenewalSettings,
  type PremiumExpiredBannerPayload,
  type PremiumRenewalPromptPayload,
} from "@/lib/premium-renewal-prompt-types"
import {
  encryptFieldAsymmetric,
  decryptFieldAsymmetric,
  generateKeyPairFromSeed,
  hexToUint8,
  looksLikeAsymmetricCiphertext,
  uint8ToHex,
} from "@/lib/crypto"
import { ENCRYPTED_DISPLAY } from "@/lib/encrypted-display"
import { makeDedupeKeyComputer, type DedupeKeyComputer } from "@/lib/import-dedupe-key"
import { requestBulkDeleteTransactions } from "@/lib/bulk-delete-client"
import {
  clearPrivacyKeyCache,
  getValidCachedPrivacyKeyHex,
  setCachedPrivacyKeyHex,
} from "@/lib/privacy-key-storage"
import { clearAllDrafts } from "@/lib/draft-storage"
import { clearAllWalletWatches } from "@/lib/wallet-watch-store"
import { DASHBOARD_CHART_RANGE_OVERRIDE_KEY } from "@/lib/dashboard-chart-mode"
import {
  type ApiTransactionRow,
  type CachedTransaction,
  cachedToClientTransaction,
  clearDb,
  dayBeforeIsoDate,
  decryptAndPersistUndecrypted,
  deleteCachedTransaction,
  getAllCached,
  getCachedCount,
  getLastSyncIso,
  getMemo,
  getRecentCached,
  getRemainingCached,
  isTxnIndexedDbAvailable,
  maxUpdatedAtIso,
  MEMO_KEYS,
  mergeLastSyncIso,
  mergeTransactionBatch,
  processApiTransactions,
  putMany,
  removeMissing,
  setLastSyncIso,
  setMemo,
  startDateForRecentWindow,
} from "@/lib/txn-cache"
import { filterTransactionsForActiveLedger } from "@/lib/envelope-ledger-visibility"
import { syncUserPublicKey } from "@/lib/sync-user-public-key"
import { transactionSyncUserMessage } from "@/lib/transaction-sync-user-message"
import { clearPendingNsec, clearNsecOnboardingIntent, getPendingNsec } from "@/lib/nostr-local-signer"

export type PageId =
  | "dashboard"
  | "runway"
  | "analytics"
  | "envelopes"
  | "envelope-allocations"
  | "envelope-detail"
  | "transactions"
  | "btc-price"
  | "researcher"
  | "funds"
  | "profile"
  | "settings"
  | "review-inbox"

function pageToHash(page: PageId, envelopeId?: string | null): string {
  if (page === "envelope-detail" && envelopeId) return `#/envelope/${envelopeId}`
  if (page === "envelope-allocations") return "#/envelopes/allocations"
  return `#/${page}`
}

function hashToPage(hash: string): { page: PageId; envelopeId?: string } {
  const path = hash.replace(/^#\/?/, "")
  if (!path || path === "/") return { page: "dashboard" }

  const envelopeMatch = path.match(/^envelope\/(.+)$/)
  if (envelopeMatch) return { page: "envelope-detail", envelopeId: envelopeMatch[1] }

  if (path === "envelopes/allocations") return { page: "envelope-allocations" }

  if (path.startsWith("settings/")) return { page: "settings" }

  const validPages: PageId[] = ["dashboard", "runway", "analytics", "envelopes", "transactions", "btc-price", "researcher", "funds", "profile", "settings", "review-inbox"]
  if (validPages.includes(path as PageId)) return { page: path as PageId }

  return { page: "dashboard" }
}

/** Cold-start transaction hydration: init until IDB recent slice; recent → full → synced during refresh. */
export type TxnLoadPhase = "init" | "recent" | "full" | "synced"

const RECENT_TXN_WINDOW_DAYS = 30

function maxUpdatedAtFromApiRows(rows: ApiTransactionRow[]): string | null {
  if (rows.length === 0) return null
  let max = rows[0]!.updatedAt ?? `${rows[0]!.date}T12:00:00.000Z`
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!
    const u = r.updatedAt ?? `${r.date}T12:00:00.000Z`
    if (u > max) max = u
  }
  return max
}

interface EncryptionState {
  ready: boolean
  needsPinUnlock: boolean
  encryptedPrivacyKey: string | null
  privacyKeySalt: string | null
}

export interface TransactionPrefill {
  payee?: string
  amount?: string
  date?: string
  notes?: string
  envelopeId?: string
  type?: "expense" | "credit"
  tags?: string[]
  /** When set, the dialog operates in "post now" mode for the given recurring rule. */
  recurringId?: string
  /**
   * Data URL of the receipt file (image or PDF) for in-dialog cross-check after scan.
   * Large; omit from persistence. Cleared when the new-transaction dialog closes.
   */
  receiptPreviewDataUrl?: string
  /**
   * Extraction confidence (0–1) returned by the receipt scanner.
   * When below RECEIPT_SCAN_LOW_CONFIDENCE_THRESHOLD the dialog shows a "please double-check" banner.
   */
  receiptScanConfidence?: number
  /**
   * Full scan stats from the receipt/statement parser.
   * Shown via the "Stats for nerds" popover in the New Transaction dialog.
   */
  receiptScanStats?: ReceiptScanStats
}

/** Pre-parsed data passed to StatementImporterDialog (scan handoff or email pending batch). */
export interface StatementImporterPrefill {
  transactions?: ParsedTransaction[]
  meta?: FoldStatementMeta
  /** Email-forwarded statement batch — dialog loads encrypted rows from the API. */
  pendingBatchId?: string
}

export interface ReferralSummaryState {
  code: string | null
  codeExpiresAt: string | null
  lastCode: {
    code: string
    expiresAt: string
    usedCount: number
    active: boolean
  } | null
  referralCount: number
  activatedCount: number
  premiumGratisUntil: string | null
  premiumTrialUntil: string | null
}

interface AppContextValue {
  state: AppState
  activeEnvelopes: Envelope[]
  discretionaryEnvelopes: Envelope[]
  activeTransactions: Transaction[]
  currentPage: PageId
  selectedEnvelopeId: string | null
  highlightTransactionId: string | null
  clearHighlightTransactionId: () => void
  transactionDialogOpen: boolean
  transactionPrefill: TransactionPrefill | null
  inputModeSheetOpen: boolean
  setInputModeSheetOpen: (open: boolean) => void
  loading: boolean
  /** Progressive transaction load phase (dashboard renders after `recent`). */
  txnLoadPhase: TxnLoadPhase
  /** True once full IDB + API sync finished for the current refresh (search/analytics complete). */
  historyReady: boolean
  /** Set when `refreshData` fails mid-sync; cleared on the next successful refresh or dismiss. */
  transactionSyncError: string | null
  clearTransactionSyncError: () => void
  /** User id for IndexedDB helpers (e.g. memoized top OC). */
  currentUserId: string | null
  /** Last persisted transaction count from IndexedDB memo (instant Settings hint). */
  memoTransactionCount: number | null
  encryption: EncryptionState
  unlockWithKey: (key: Uint8Array) => void

  transactionEnvelopeFilter: Set<string>
  clearTransactionEnvelopeFilter: () => void
  navigateTo: (page: PageId, envelopeId?: string, opts?: { highlightTxnId?: string; envelopeFilter?: string; openAllocations?: boolean }) => void
  /** Transient "what-if" expense (USD) previewed on the Runway page; cleared on dismiss. */
  runwayWhatIfUsd: number | null
  setRunwayWhatIf: (amountUsd: number | null) => void
  setTransactionDialogOpen: (open: boolean) => void
  openNewTransaction: (prefill?: TransactionPrefill) => void
  statementImporterOpen: boolean
  statementImporterPrefill: StatementImporterPrefill | null
  /** Incremented on each openStatementImporter() call so the dialog remounts with fresh state. */
  statementImporterKey: number
  setStatementImporterOpen: (open: boolean) => void
  openStatementImporter: (prefill?: StatementImporterPrefill) => void

  addTransaction: (txn: Omit<Transaction, "id">) => Promise<boolean>
  editTransaction: (id: string, updates: Partial<Omit<Transaction, "id">>) => void
  deleteTransaction: (id: string) => void
  /** Delete many transactions by id (duplicate cleanup). Returns count deleted. */
  bulkDeleteTransactions: (ids: string[]) => Promise<number>

  addEnvelope: (envelope: Omit<Envelope, "id">) => void
  editEnvelope: (id: string, updates: Partial<Omit<Envelope, "id">>) => void
  archiveEnvelope: (id: string) => void
  restoreEnvelope: (id: string) => void
  restoreDeletedEnvelope: (id: string) => void
  deleteEnvelope: (id: string) => Promise<void>
  mergeEnvelope: (sourceId: string, targetId: string) => Promise<void>

  setMonthlyIncome: (income: number) => void
  setBtcDisplayUnit: (unit: BtcDisplayUnit) => void
  setOpportunityCostEnabled: (enabled: boolean) => void
  setCommunicationPreference: (key: CommunicationPreferenceKey, enabled: boolean) => Promise<void>
  setSavingsExperience: (experience: "engaged" | "dismissed") => Promise<void>
  completeWalkthrough: () => Promise<void>
  restartWalkthrough: () => Promise<void>
  updateSetupGuidePrefs: (patch: {
    setupGuideSnoozedUntil?: string | null
    setupGuideDismissed?: boolean
    setupGuideShowOnDashboard?: boolean
  }) => Promise<void>
  addTag: (tag: string) => void
  deleteTag: (id: string) => void
  refreshData: () => Promise<void>
  clearLocalTransactionCache: () => Promise<void>
  encryptForStorage: (plaintext: string) => Promise<string>
  /**
   * Build a per-import HMAC dedupe-key computer from the cached privacy-key seed,
   * or null if the session is locked. Create one per import and reuse across chunks.
   */
  makeImportDedupeKeyComputer: () => DedupeKeyComputer | null
  logout: () => void
  isAdmin: boolean
  /** Stored billing tier (Stripe). */
  subscriptionTier: "free" | "premium"
  /** Resolved tier including trial + referral gratis windows. */
  effectiveTier: "free" | "premium-trial" | "premium"
  /** True when user has full or trial premium features (not effective free). */
  hasPremiumFeatures: boolean
  /** Referred user who has not linked a bank yet — Plaid allowed; other premium features locked until activation. */
  refereePendingBankLink: boolean
  /** True when this account has ever redeemed a referral code as the referee. */
  referralRefereeRedeemed: boolean
  /** True when Settings may show post-onboarding referral code entry (7-day window). */
  referralRefereeCanRedeem: boolean
  /** Trial length (months) for this referee while bank link is pending; from referrer billing tier. */
  referralRefereeTrialMonths: 1 | 3 | null
  premiumTrialUntilIso: string | null
  premiumGratisUntilIso: string | null
  premiumRenewalPrompt: PremiumRenewalPromptPayload | null
  premiumExpiredBanner: PremiumExpiredBannerPayload | null
  dismissPremiumRenewalUi: (logKey: string) => Promise<void>
  referralSummary: ReferralSummaryState | null

  /** Server account creation (ISO date YYYY-MM-DD). */
  accountCreatedAtIso: string | null
  /** When onboarding finished (ISO datetime). */
  onboardingCompletedAtIso: string | null

  pendingTransactions: PendingTransaction[]
  pendingCount: number
  confirmPending: (
    id: string,
    envelopeId?: string,
    updates?: {
      payee?: string
      amount?: number
      date?: string
      notes?: string | null
      tags?: string[]
    },
  ) => Promise<void>
  dismissPending: (id: string) => Promise<void>
  confirmAllPending: () => Promise<void>

  recurringTransactions: RecurringTransaction[]
  editRecurringTransaction: (
    id: string,
    updates: {
      payee?: string
      amount?: number
      type?: "expense" | "credit"
      envelopeId?: string
      cadence?: RecurringTransaction["cadence"]
      endDate?: string | null
      tags?: string[]
      notes?: string | null
    },
  ) => Promise<void>
  deleteRecurringTransaction: (id: string) => Promise<void>
}

const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useApp must be used within AppProvider")
  return ctx
}

function decryptPendingRecords(
  records: PendingTransaction[],
  secretKey: Uint8Array | null,
): PendingTransaction[] {
  if (!secretKey) {
    return records.map((t) => ({
      ...t,
      payee: looksLikeAsymmetricCiphertext(t.payee) ? ENCRYPTED_DISPLAY : t.payee,
      notes:
        t.notes != null && looksLikeAsymmetricCiphertext(t.notes) ? ENCRYPTED_DISPLAY : t.notes,
    }))
  }
  return records.map((t) => {
    let payee = t.payee
    let notes = t.notes
    try {
      payee = decryptFieldAsymmetric(t.payee, secretKey)
    } catch {
      payee = looksLikeAsymmetricCiphertext(t.payee) ? ENCRYPTED_DISPLAY : t.payee
    }
    if (t.notes) {
      try {
        notes = decryptFieldAsymmetric(t.notes, secretKey)
      } catch {
        notes = looksLikeAsymmetricCiphertext(t.notes) ? ENCRYPTED_DISPLAY : t.notes
      }
    }
    return { ...t, payee, notes }
  })
}

function decryptRecurringRules(
  rules: RecurringTransaction[],
  secretKey: Uint8Array | null,
  locked: boolean,
): RecurringTransaction[] {
  if (locked || !secretKey) {
    return rules.map((r) => ({
      ...r,
      payee: looksLikeAsymmetricCiphertext(r.payee) ? ENCRYPTED_DISPLAY : r.payee,
      notes:
        r.notes != null && looksLikeAsymmetricCiphertext(r.notes) ? ENCRYPTED_DISPLAY : r.notes,
      isDecrypted: false,
    }))
  }
  return rules.map((r) => {
    let payee = r.payee
    let notes = r.notes
    let isDecrypted = true
    try {
      payee = decryptFieldAsymmetric(r.payee, secretKey)
    } catch {
      const payeeLooksEncrypted = looksLikeAsymmetricCiphertext(r.payee)
      payee = payeeLooksEncrypted ? ENCRYPTED_DISPLAY : r.payee
      if (payeeLooksEncrypted) isDecrypted = false
    }
    if (notes) {
      try {
        notes = decryptFieldAsymmetric(notes, secretKey)
      } catch {
        const notesLooksEncrypted = looksLikeAsymmetricCiphertext(notes)
        notes = notesLooksEncrypted ? ENCRYPTED_DISPLAY : notes
        if (notesLooksEncrypted) isDecrypted = false
      }
    }
    return { ...r, payee, notes, isDecrypted }
  })
}

function applyPrivacyKey(key: Uint8Array, publicKeyRef: React.MutableRefObject<Uint8Array | null>) {
  const { publicKey } = generateKeyPairFromSeed(key)
  publicKeyRef.current = publicKey
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(getDefaultState)
  const [currentPage, setCurrentPage] = useState<PageId>(() => {
    if (typeof window === "undefined") return "dashboard"
    const { page } = hashToPage(window.location.hash)
    return page
  })
  const [selectedEnvelopeId, setSelectedEnvelopeId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null
    return hashToPage(window.location.hash).envelopeId ?? null
  })
  const [highlightTransactionId, setHighlightTransactionId] = useState<string | null>(null)
  const [transactionDialogOpen, setTransactionDialogOpen] = useState(false)
  const [transactionPrefill, setTransactionPrefill] = useState<TransactionPrefill | null>(null)
  const [runwayWhatIfUsd, setRunwayWhatIfUsd] = useState<number | null>(null)

  useEffect(() => {
    if (transactionDialogOpen) return
    setTransactionPrefill((prev) => {
      if (!prev?.receiptPreviewDataUrl) return prev
      const next = { ...prev }
      delete next.receiptPreviewDataUrl
      return Object.keys(next).length > 0 ? next : null
    })
  }, [transactionDialogOpen])

  const [statementImporterOpen, setStatementImporterOpen] = useState(false)
  const [statementImporterPrefill, setStatementImporterPrefill] = useState<StatementImporterPrefill | null>(null)
  const [statementImporterKey, setStatementImporterKey] = useState(0)

  const openStatementImporter = useCallback((prefill?: StatementImporterPrefill) => {
    setStatementImporterPrefill(prefill ?? null)
    setStatementImporterKey(k => k + 1)
    setStatementImporterOpen(true)
  }, [])

  const [inputModeSheetOpen, setInputModeSheetOpen] = useState(false)
  const [transactionEnvelopeFilter, setTransactionEnvelopeFilter] = useState<Set<string>>(() => new Set())
  const [txnLoadPhase, setTxnLoadPhase] = useState<TxnLoadPhase>("init")
  const [transactionSyncError, setTransactionSyncError] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [memoTransactionCount, setMemoTransactionCount] = useState<number | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [subscriptionTier, setSubscriptionTier] = useState<"free" | "premium">("free")
  const [effectiveTier, setEffectiveTier] = useState<"free" | "premium-trial" | "premium">("free")
  const [premiumTrialUntilIso, setPremiumTrialUntilIso] = useState<string | null>(null)
  const [premiumGratisUntilIso, setPremiumGratisUntilIso] = useState<string | null>(null)
  const [premiumRenewalPrompt, setPremiumRenewalPrompt] = useState<PremiumRenewalPromptPayload | null>(null)
  const [premiumExpiredBanner, setPremiumExpiredBanner] = useState<PremiumExpiredBannerPayload | null>(null)
  const [referralSummary, setReferralSummary] = useState<ReferralSummaryState | null>(null)
  const [refereePendingBankLink, setRefereePendingBankLink] = useState(false)
  const [referralRefereeRedeemed, setReferralRefereeRedeemed] = useState(false)
  const [referralRefereeCanRedeem, setReferralRefereeCanRedeem] = useState(false)
  const [referralRefereeTrialMonths, setReferralRefereeTrialMonths] = useState<1 | 3 | null>(null)
  const [accountCreatedAtIso, setAccountCreatedAtIso] = useState<string | null>(null)
  const [onboardingCompletedAtIso, setOnboardingCompletedAtIso] = useState<string | null>(null)
  const [pendingTransactions, setPendingTransactions] = useState<PendingTransaction[]>([])
  const [recurringTransactions, setRecurringTransactions] = useState<RecurringTransaction[]>([])
  /** Latest envelopes for synchronous guards before optimistic updates (avoid mutable flags inside setState updaters). */
  const envelopesRef = useRef(state.envelopes)
  envelopesRef.current = state.envelopes

  const mounted = useRef(false)
  const isPopstate = useRef(false)

  const privacyKeyRef = useRef<Uint8Array | null>(null)
  const publicKeyRef = useRef<Uint8Array | null>(null)
  /** True while user has wrapped privacy key but has not unlocked this session (avoid showing encrypted pending as gibberish). */
  const pendingLockedRef = useRef(false)
  const currentUserIdRef = useRef<string | null>(null)
  /** Every N refreshes, fetch all transactions so server-side deletes reconcile (delta has no tombstones). */
  const txnSyncSeqRef = useRef(0)
  /** After first `getRemainingCached` (or full `getAllCached` on unlock), skip re-reading entire older IDB on later refreshes. */
  const fullIdbHydratedRef = useRef(false)
  const [encryption, setEncryption] = useState<EncryptionState>({
    ready: false,
    needsPinUnlock: false,
    encryptedPrivacyKey: null,
    privacyKeySalt: null,
  })

  const initEncryption = useCallback(async () => {
    try {
      const res = await fetch("/api/user/encryption")
      if (res.status === 401 || res.status === 403) {
        signOut({ callbackUrl: "/auth" })
        return
      }
      if (!res.ok) return

      const data = await res.json() as {
        userId: string
        encryptedPrivacyKey: string | null
        privacyKeySalt: string | null
        isNostr: boolean
        nostrPubkey: string | null
      }

      currentUserIdRef.current = data.userId
      setCurrentUserId(data.userId)

      if (!data.encryptedPrivacyKey) {
        pendingLockedRef.current = false
        setEncryption({ ready: true, needsPinUnlock: false, encryptedPrivacyKey: null, privacyKeySalt: null })
        return
      }

      const cachedKey = getValidCachedPrivacyKeyHex(data.userId)
      if (cachedKey) {
        const pk = hexToUint8(cachedKey)
        privacyKeyRef.current = pk
        applyPrivacyKey(pk, publicKeyRef)
        void syncUserPublicKey(pk)
        pendingLockedRef.current = false
        setEncryption({ ready: true, needsPinUnlock: false, encryptedPrivacyKey: null, privacyKeySalt: null })
        return
      }

      // Nsec fallback users have privacyKeySalt (PIN-based); skip NIP-04 and use PIN unlock path.
      const isNsecFallback = data.isNostr && data.privacyKeySalt != null
      if (data.isNostr && data.nostrPubkey && !isNsecFallback) {
        const nostrExt = (window as unknown as {
          nostr?: { nip04?: { decrypt: (pubkey: string, ciphertext: string) => Promise<string> } }
        }).nostr

        if (nostrExt?.nip04) {
          try {
            const hexKey = await nostrExt.nip04.decrypt(data.nostrPubkey, data.encryptedPrivacyKey)
            const pk = hexToUint8(hexKey)
            privacyKeyRef.current = pk
            applyPrivacyKey(pk, publicKeyRef)
            void syncUserPublicKey(pk)
            setCachedPrivacyKeyHex(data.userId, hexKey)
            pendingLockedRef.current = false
            setEncryption({ ready: true, needsPinUnlock: false, encryptedPrivacyKey: null, privacyKeySalt: null })
            return
          } catch { /* fall through */ }
        }

        // No extension (or it refused). If the raw nsec is still in memory (nsec-paste
        // login for a returning user), use nostr-tools NIP-04 decrypt locally.
        const pendingNsec = getPendingNsec()
        if (pendingNsec) {
          try {
            const { decrypt: nip04Decrypt } = await import("nostr-tools/nip04")
            const hexKey = nip04Decrypt(pendingNsec, data.nostrPubkey, data.encryptedPrivacyKey)
            const pk = hexToUint8(hexKey)
            privacyKeyRef.current = pk
            applyPrivacyKey(pk, publicKeyRef)
            void syncUserPublicKey(pk)
            setCachedPrivacyKeyHex(data.userId, hexKey)
            pendingLockedRef.current = false
            setEncryption({ ready: true, needsPinUnlock: false, encryptedPrivacyKey: null, privacyKeySalt: null })
            return
          } catch { /* fall through to PIN unlock */ }
        }
      }

      pendingLockedRef.current = true
      setEncryption({
        ready: false,
        needsPinUnlock: true,
        encryptedPrivacyKey: data.encryptedPrivacyKey,
        privacyKeySalt: data.privacyKeySalt,
      })
    } catch {
      pendingLockedRef.current = false
      setEncryption({ ready: true, needsPinUnlock: false, encryptedPrivacyKey: null, privacyKeySalt: null })
    }
  }, [])

  const clearTransactionSyncError = useCallback(() => {
    setTransactionSyncError(null)
  }, [])

const dismissPremiumRenewalUi = useCallback(async (logKey: string) => {
  const res = await fetch("/api/user/premium-renewal-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ logKey }),
  })
  if (res.status === 401 || res.status === 403) {
    signOut({ callbackUrl: "/auth" })
    return
  }
  setPremiumRenewalPrompt((current) => (current?.logKey === logKey ? null : current))
  setPremiumExpiredBanner((current) => (current?.logKey === logKey ? null : current))
}, [])

  const refreshData = useCallback(async () => {
    setTransactionSyncError(null)
    try {
      await fetch("/api/recurring/process", { method: "POST" }).catch(() => {})

      const [envRes, settingsRes, pendingRes, tagsRes, recurringRes] = await Promise.all([
        fetch("/api/envelopes"),
        fetch("/api/user/settings"),
        fetch("/api/pending-transactions"),
        fetch("/api/tags"),
        fetch("/api/recurring"),
      ])

      const authFailure = [envRes, settingsRes, tagsRes].some(
        (r) => r.status === 401 || r.status === 403,
      )
      if (authFailure) {
        signOut({ callbackUrl: "/auth" })
        return
      }
      if (!envRes.ok || !settingsRes.ok) {
        throw new Error("Failed to fetch data")
      }

      if (pendingRes.ok) {
        if (pendingLockedRef.current && !privacyKeyRef.current) {
          setPendingTransactions([])
        } else {
          let pendingData: PendingTransaction[] = await pendingRes.json()
          pendingData = decryptPendingRecords(pendingData, privacyKeyRef.current)
          setPendingTransactions(pendingData)
        }
      }
      if (recurringRes.ok) {
        const locked = pendingLockedRef.current && !privacyKeyRef.current
        const recurringData = await recurringRes.json() as RecurringTransaction[]
        setRecurringTransactions(decryptRecurringRules(recurringData, privacyKeyRef.current, locked))
      }
      if (!tagsRes.ok) throw new Error("Failed to fetch tags")

      const [envelopes, settings] = await Promise.all([
        envRes.json(),
        settingsRes.json(),
      ])
      const tags = await tagsRes.json() as Tag[]

      setUserRole(settings.role ?? null)
      const createdRaw = (settings as { createdAt?: unknown }).createdAt
      setAccountCreatedAtIso(
        typeof createdRaw === "string" ? createdRaw.split("T")[0]! : null,
      )
      const onboardingRaw = (settings as { onboardingCompletedAt?: unknown }).onboardingCompletedAt
      setOnboardingCompletedAtIso(typeof onboardingRaw === "string" ? onboardingRaw : null)
      setSubscriptionTier(
        settings.subscriptionTier === "premium" ? "premium" : "free",
      )
      const etRaw = (settings as { effectiveTier?: string }).effectiveTier
      const nowMs = Date.now()
      const trialMs =
        typeof settings.premiumTrialUntil === "string"
          ? Date.parse(settings.premiumTrialUntil)
          : NaN
      const gratisMs =
        typeof settings.premiumGratisUntil === "string"
          ? Date.parse(settings.premiumGratisUntil)
          : NaN
      const et =
        etRaw === "premium" || etRaw === "premium-trial"
          ? etRaw
          : settings.subscriptionTier === "premium"
            ? "premium"
            : Number.isFinite(gratisMs) && gratisMs > nowMs
              ? "premium"
              : Number.isFinite(trialMs) && trialMs > nowMs
                ? "premium-trial"
                : "free"
      setEffectiveTier(et)
      setPremiumTrialUntilIso(
        typeof settings.premiumTrialUntil === "string" ? settings.premiumTrialUntil : null,
      )
      setPremiumGratisUntilIso(
        typeof settings.premiumGratisUntil === "string" ? settings.premiumGratisUntil : null,
      )
      const renewalUi = parsePremiumRenewalSettings(settings)
      setPremiumRenewalPrompt(renewalUi.premiumRenewalPrompt)
      setPremiumExpiredBanner(renewalUi.premiumExpiredBanner)
      setRefereePendingBankLink(
        (settings as { referralRefereePendingBankLink?: unknown }).referralRefereePendingBankLink === true,
      )
      setReferralRefereeRedeemed(
        (settings as { referralRefereeRedeemed?: unknown }).referralRefereeRedeemed === true,
      )
      setReferralRefereeCanRedeem(
        (settings as { referralRefereeCanRedeem?: unknown }).referralRefereeCanRedeem === true,
      )
      const trm = (settings as { referralRefereeTrialMonths?: unknown }).referralRefereeTrialMonths
      setReferralRefereeTrialMonths(trm === 1 || trm === 3 ? trm : null)
      const ref = settings.referral
      if (ref && typeof ref === "object" && !Array.isArray(ref)) {
        setReferralSummary({
          code: typeof ref.code === "string" || ref.code === null ? ref.code : null,
          codeExpiresAt:
            typeof ref.codeExpiresAt === "string" || ref.codeExpiresAt === null
              ? ref.codeExpiresAt
              : null,
          lastCode:
            ref.lastCode &&
            typeof ref.lastCode === "object" &&
            typeof ref.lastCode.code === "string"
              ? {
                  code: ref.lastCode.code,
                  expiresAt: String(ref.lastCode.expiresAt ?? ""),
                  usedCount: Number(ref.lastCode.usedCount ?? 0),
                  active: Boolean(ref.lastCode.active),
                }
              : null,
          referralCount: Number(ref.referralCount ?? 0),
          activatedCount: Number(ref.activatedCount ?? 0),
          premiumGratisUntil:
            typeof ref.premiumGratisUntil === "string" || ref.premiumGratisUntil === null
              ? ref.premiumGratisUntil
              : null,
          premiumTrialUntil:
            typeof ref.premiumTrialUntil === "string" || ref.premiumTrialUntil === null
              ? ref.premiumTrialUntil
              : null,
        })
      } else {
        setReferralSummary(null)
      }
      setState(prev => ({
        ...prev,
        envelopes,
        tags,
        monthlyIncome: settings.monthlyIncome || 0,
        btcDisplayUnit: settings.btcDisplayUnit || "sats",
        opportunityCostEnabled: settings.opportunityCostEnabled ?? false,
        communicationPreferences: normalizeCommunicationPreferences(
          settings.emailPreferences ?? settings.communicationPreferences ?? {},
        ),
        savingsExperience:
          typeof (settings as { savingsExperience?: string }).savingsExperience === "string"
            ? (settings as { savingsExperience: string }).savingsExperience
            : "engaged",
        walkthroughCompleted: settings.walkthroughCompleted === true,
        setupGuideSnoozedUntil:
          typeof (settings as { setupGuideSnoozedUntil?: string | null }).setupGuideSnoozedUntil ===
          "string"
            ? (settings as { setupGuideSnoozedUntil: string }).setupGuideSnoozedUntil
            : null,
        setupGuideDismissed:
          (settings as { setupGuideDismissed?: boolean }).setupGuideDismissed === true,
        setupGuideShowOnDashboard:
          (settings as { setupGuideShowOnDashboard?: boolean }).setupGuideShowOnDashboard !==
          false,
      }))

      const uid = currentUserIdRef.current
      if (!uid) {
        // Do not force "synced" — no txn hydration ran; leaving the phase avoids implying full history.
        return
      }
      const userId = uid

      const idbAvailable = await isTxnIndexedDbAvailable(userId)
      const lastSync = await getLastSyncIso(userId)
      const cachedCount = await getCachedCount(userId)
      txnSyncSeqRef.current += 1
      const forceFullTxnResync = txnSyncSeqRef.current % 12 === 0
      const fullTxnSync =
        cachedCount === 0 || lastSync == null || forceFullTxnResync
      if (fullTxnSync) {
        setTxnLoadPhase("full")
      }

      const lockedSession = pendingLockedRef.current && !privacyKeyRef.current
      const secretKey = privacyKeyRef.current
      const processOpts = { lockedSession, secretKey }

      const cutoff = startDateForRecentWindow(RECENT_TXN_WINDOW_DAYS)
      const endOlder = dayBeforeIsoDate(cutoff)

      async function mergeApiRows(rows: ApiTransactionRow[]): Promise<void> {
        if (rows.length === 0) return
        const cachedTxns = await processApiTransactions(rows, processOpts)
        await putMany(userId, cachedTxns)
        setState(prev => ({
          ...prev,
          transactions: mergeTransactionBatch(prev.transactions, cachedTxns),
        }))
      }

      if (fullTxnSync) {
        async function hydrateRemainingIdb(): Promise<void> {
          if (fullIdbHydratedRef.current) return
          if (!idbAvailable || lockedSession) {
            fullIdbHydratedRef.current = true
            return
          }
          const rem = await getRemainingCached(userId, cutoff)
          setState(prev => ({
            ...prev,
            transactions: mergeTransactionBatch(prev.transactions, rem),
          }))
          fullIdbHydratedRef.current = true
        }

        async function fetchRecentApi(): Promise<ApiTransactionRow[] | null> {
          const txnRes = await fetch(
            `/api/transactions?startDate=${encodeURIComponent(cutoff)}`,
          )
          if (txnRes.status === 401 || txnRes.status === 403) {
            signOut({ callbackUrl: "/auth" })
            return null
          }
          if (!txnRes.ok) throw new Error("Failed to fetch transactions")
          const rows = await txnRes.json() as ApiTransactionRow[]
          await mergeApiRows(rows)
          return rows
        }

        const [recentOutcome] = await Promise.all([
          fetchRecentApi(),
          hydrateRemainingIdb(),
        ])
        if (recentOutcome === null) return

        const rowsRecent = recentOutcome

        const txnResOlder = await fetch(
          `/api/transactions?endDate=${encodeURIComponent(endOlder)}`,
        )
        if (txnResOlder.status === 401 || txnResOlder.status === 403) {
          signOut({ callbackUrl: "/auth" })
          return
        }
        if (!txnResOlder.ok) throw new Error("Failed to fetch transactions")
        const rowsOlder = await txnResOlder.json() as ApiTransactionRow[]
        await mergeApiRows(rowsOlder)

        const allIds = new Set<string>([
          ...rowsRecent.map((r) => r.id),
          ...rowsOlder.map((r) => r.id),
        ])
        await removeMissing(userId, allIds)
        setState(prev => ({
          ...prev,
          transactions: transactionsAfterFullServerSync(prev.transactions, allIds),
        }))

        const mr = maxUpdatedAtFromApiRows(rowsRecent)
        const mo = maxUpdatedAtFromApiRows(rowsOlder)
        const incomingMax =
          mr && mo ? (mr > mo ? mr : mo) : (mr ?? mo ?? null)
        const mergedSync = mergeLastSyncIso(lastSync, incomingMax)
        if (mergedSync) await setLastSyncIso(userId, mergedSync)
        if (!fullIdbHydratedRef.current) fullIdbHydratedRef.current = true
      } else {
        const needIdbSnapshot = idbAvailable && !fullIdbHydratedRef.current
        const idbSnapshotPromise = needIdbSnapshot
          ? Promise.all([
              getRecentCached(userId, RECENT_TXN_WINDOW_DAYS),
              getRemainingCached(userId, cutoff),
            ]).then(parts => parts.flat())
          : Promise.resolve([] as CachedTransaction[])

        const txnResPromise = fetch(
          `/api/transactions?since=${encodeURIComponent(lastSync!)}`,
        )

        const [cachedSnapshot, txnRes] = await Promise.all([
          idbSnapshotPromise,
          txnResPromise,
        ])

        if (txnRes.status === 401 || txnRes.status === 403) {
          signOut({ callbackUrl: "/auth" })
          return
        }
        if (!txnRes.ok) throw new Error("Failed to fetch transactions")

        const rows = await txnRes.json() as ApiTransactionRow[]
        const cachedTxns = await processApiTransactions(rows, processOpts)
        await putMany(userId, cachedTxns)

        setState(prev => {
          let nextTxns: Transaction[]
          if (idbAvailable) {
            if (needIdbSnapshot) {
              const byId = new Map(
                cachedSnapshot.map((c) => [c.id, cachedToClientTransaction(c)]),
              )
              for (const c of cachedTxns) {
                byId.set(c.id, cachedToClientTransaction(c))
              }
              nextTxns = Array.from(byId.values()).sort(compareTransactionsDesc)
            } else {
              nextTxns = mergeTransactionBatch(prev.transactions, cachedTxns)
            }
          } else if (cachedTxns.length > 0) {
            const byId = new Map(prev.transactions.map((t) => [t.id, t]))
            for (const c of cachedTxns) {
              byId.set(c.id, cachedToClientTransaction(c))
            }
            nextTxns = Array.from(byId.values()).sort(compareTransactionsDesc)
          } else {
            // Empty delta means no changes since lastSync — keep in-memory history (no IDB fallback).
            nextTxns = prev.transactions
          }
          return { ...prev, transactions: nextTxns }
        })

        const incomingMax = maxUpdatedAtIso(cachedTxns)
        const mergedSync = mergeLastSyncIso(lastSync, incomingMax)
        if (mergedSync) await setLastSyncIso(userId, mergedSync)
        fullIdbHydratedRef.current = true
      }

      const count = await getCachedCount(userId)
      setMemoTransactionCount(count)
      await setMemo(userId, MEMO_KEYS.txnCount, count)

      setTxnLoadPhase("synced")
    } catch (err) {
      console.error("refreshData failed", err)
      setTransactionSyncError(transactionSyncUserMessage(err))
      // Do not advance to "synced" on failure — UI should not imply history is complete.
    }
  }, [])

  const unlockWithKey = useCallback((key: Uint8Array) => {
    privacyKeyRef.current = key
    applyPrivacyKey(key, publicKeyRef)
    void syncUserPublicKey(key)
    pendingLockedRef.current = false
    if (currentUserIdRef.current) {
      try {
        setCachedPrivacyKeyHex(currentUserIdRef.current, uint8ToHex(key))
      } catch {
        /* private mode / quota */
      }
    }
    setEncryption({ ready: true, needsPinUnlock: false, encryptedPrivacyKey: null, privacyKeySalt: null })
    void (async () => {
      const uid = currentUserIdRef.current
      if (uid) {
        const decrypted = await decryptAndPersistUndecrypted(uid, key)
        const all = await getAllCached(uid)
        const forState = all.length > 0 ? all : decrypted
        if (forState.length > 0) {
          const sortedForState = [...forState].sort(compareTransactionsDesc)
          fullIdbHydratedRef.current = true
          setState(prev => ({
            ...prev,
            transactions: sortedForState.map(cachedToClientTransaction),
          }))
          setTxnLoadPhase("full")
        }
      }
      await refreshData()
    })()
  }, [refreshData])

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      void (async () => {
        await initEncryption()
        const uid = currentUserIdRef.current
        // 401 sign-out or failed encryption fetch leaves no user — keep phase "init" until redirect.
        if (!uid) return
        const memoCount = await getMemo<number>(uid, MEMO_KEYS.txnCount)
        setMemoTransactionCount(memoCount)
        const key = privacyKeyRef.current
        const lockedWithoutKey = pendingLockedRef.current && !key
        if (!lockedWithoutKey) {
          if (key) {
            await decryptAndPersistUndecrypted(uid, key)
          }
          const recentRows = await getRecentCached(uid, RECENT_TXN_WINDOW_DAYS)
          setState(prev => ({
            ...prev,
            transactions: mergeTransactionBatch(prev.transactions, recentRows),
          }))
        }
        setTxnLoadPhase("recent")
        await refreshData()
      })()
    }
  }, [initEncryption, refreshData])

  const navigateTo = useCallback((page: PageId, envelopeId?: string, opts?: { highlightTxnId?: string; envelopeFilter?: string; openAllocations?: boolean }) => {
    const targetPage = page === "envelopes" && opts?.openAllocations ? "envelope-allocations" : page
    setCurrentPage(targetPage)
    if (targetPage === "envelope-detail" && envelopeId) {
      setSelectedEnvelopeId(envelopeId)
    } else {
      setSelectedEnvelopeId(null)
    }
    setHighlightTransactionId(opts?.highlightTxnId ?? null)
    if (targetPage === "envelope-detail") {
      setTransactionEnvelopeFilter(new Set())
    } else if (opts?.envelopeFilter) {
      setTransactionEnvelopeFilter(new Set([opts.envelopeFilter]))
    }

    if (!isPopstate.current) {
      const hash = pageToHash(targetPage, envelopeId)
      if (window.location.hash !== hash) {
        window.history.pushState(null, "", hash)
      }
    }
    isPopstate.current = false
  }, [])

  const setRunwayWhatIf = useCallback((amountUsd: number | null) => {
    setRunwayWhatIfUsd(
      typeof amountUsd === "number" && Number.isFinite(amountUsd) && amountUsd > 0 ? amountUsd : null,
    )
  }, [])

  useEffect(() => {
    function syncRouteFromHash() {
      const { page, envelopeId } = hashToPage(window.location.hash)
      // Mark as popstate so navigateTo skips pushState — but since navigateTo is
      // not called inside this handler we must reset the flag ourselves at the end,
      // otherwise the very next user-triggered navigateTo silently skips pushState
      // and the history entry for that navigation is never written.
      isPopstate.current = true
      setCurrentPage(page)
      setSelectedEnvelopeId(page === "envelope-detail" && envelopeId ? envelopeId : null)
      // Clear any envelope filter when going back to a page that isn't transactions.
      if (page !== "transactions") setTransactionEnvelopeFilter(new Set())
      // Reset immediately — navigateTo is never invoked inside this handler so it
      // will never reset the flag on our behalf.
      isPopstate.current = false
    }

    function onPopState() {
      syncRouteFromHash()
    }

    function onHashChange() {
      // In-page hash changes (e.g. `<a href="#/...">`) do not fire popstate; keep React in sync with the URL.
      syncRouteFromHash()
    }

    window.addEventListener("popstate", onPopState)
    window.addEventListener("hashchange", onHashChange)

    if (!window.location.hash) {
      window.history.replaceState({ page: "dashboard" }, "", "#/dashboard")
    }

    return () => {
      window.removeEventListener("popstate", onPopState)
      window.removeEventListener("hashchange", onHashChange)
    }
  }, [])

  const addTransaction = useCallback(async (txn: Omit<Transaction, "id">) => {
    const optimisticId = generateId()
    setState(prev => ({
      ...prev,
      transactions: [{ ...txn, id: optimisticId }, ...prev.transactions],
    }))

    try {
      const payload = { ...txn }
      if (publicKeyRef.current) {
        payload.payee = encryptFieldAsymmetric(txn.payee, publicKeyRef.current)
        if (payload.notes) payload.notes = encryptFieldAsymmetric(payload.notes, publicKeyRef.current)
      }

      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        const created = await res.json() as ApiTransactionRow
        const uid = currentUserIdRef.current
        const lockedSession = pendingLockedRef.current && !privacyKeyRef.current
        const secretKey = privacyKeyRef.current
        const [cached] = await processApiTransactions([created], { lockedSession, secretKey })
        if (uid) {
          await putMany(uid, [cached])
          const prevSync = await getLastSyncIso(uid)
          const nextSync = mergeLastSyncIso(prevSync, cached.updatedAt)
          if (nextSync) await setLastSyncIso(uid, nextSync)
        }
        const clientTxn = cachedToClientTransaction(cached)
        setState((prev) => ({
          ...prev,
          transactions: applyServerTransactionAfterOptimisticCreate(
            prev.transactions,
            optimisticId,
            clientTxn,
          ),
        }))
        return true
      } else {
        setState(prev => ({
          ...prev,
          transactions: prev.transactions.filter(t => t.id !== optimisticId),
        }))
        return false
      }
    } catch {
      setState(prev => ({
        ...prev,
        transactions: prev.transactions.filter(t => t.id !== optimisticId),
      }))
      return false
    }
  }, [])

  const editTransaction = useCallback(async (id: string, updates: Partial<Omit<Transaction, "id">>) => {
    setState(prev => ({
      ...prev,
      transactions: prev.transactions.map(t => (t.id === id ? { ...t, ...updates } : t)),
    }))

    try {
      const payload: Record<string, unknown> = { id, ...updates }
      if (publicKeyRef.current) {
        if (typeof payload.payee === "string")
          payload.payee = encryptFieldAsymmetric(payload.payee as string, publicKeyRef.current)
        if (typeof payload.notes === "string")
          payload.notes = encryptFieldAsymmetric(payload.notes as string, publicKeyRef.current)
      }

      const res = await fetch("/api/transactions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        const updated = await res.json() as ApiTransactionRow
        const uid = currentUserIdRef.current
        const lockedSession = pendingLockedRef.current && !privacyKeyRef.current
        const secretKey = privacyKeyRef.current
        const [cached] = await processApiTransactions([updated], { lockedSession, secretKey })
        if (uid) {
          await putMany(uid, [cached])
          const prevSync = await getLastSyncIso(uid)
          const nextSync = mergeLastSyncIso(prevSync, cached.updatedAt)
          if (nextSync) await setLastSyncIso(uid, nextSync)
        }
        setState(prev => ({
          ...prev,
          transactions: prev.transactions.map(t =>
            t.id === id ? cachedToClientTransaction(cached) : t,
          ),
        }))
      } else {
        await refreshData()
      }
    } catch {
      refreshData()
    }
  }, [refreshData])

  const deleteTransaction = useCallback(async (id: string) => {
    setState(prev => {
      const txn = prev.transactions.find(t => t.id === id)
      const idsToRemove = new Set([id])
      if (txn && shouldCascadeDeleteTransactionBatch(txn) && txn.fundingBatchId) {
        for (const t of prev.transactions) {
          if (t.fundingBatchId === txn.fundingBatchId) idsToRemove.add(t.id)
        }
      }
      return {
        ...prev,
        transactions: prev.transactions.filter(t => !idsToRemove.has(t.id)),
      }
    })

    try {
      const res = await fetch(`/api/transactions?id=${id}`, { method: "DELETE" })
      if (res.ok && currentUserIdRef.current) {
        const body = (await res.json().catch(() => ({}))) as { deletedIds?: string[] }
        const deletedIds = Array.isArray(body.deletedIds) && body.deletedIds.length > 0 ? body.deletedIds : [id]
        const deletedSet = new Set(deletedIds)
        setState(prev => ({
          ...prev,
          transactions: prev.transactions.filter(t => !deletedSet.has(t.id)),
        }))
        await Promise.all(
          deletedIds.map((deletedId) =>
            deleteCachedTransaction(currentUserIdRef.current!, deletedId),
          ),
        )
      } else if (!res.ok) {
        await refreshData()
      }
    } catch {
      refreshData()
    }
  }, [refreshData])

  const bulkDeleteTransactions = useCallback(async (ids: string[]): Promise<number> => {
    const idSet = new Set(ids)
    if (idSet.size === 0) return 0

    // Optimistic removal.
    setState(prev => ({
      ...prev,
      transactions: prev.transactions.filter(t => !idSet.has(t.id)),
    }))

    try {
      const deleted = await requestBulkDeleteTransactions(Array.from(idSet))
      if (currentUserIdRef.current) {
        await Promise.all(
          Array.from(idSet).map((id) =>
            deleteCachedTransaction(currentUserIdRef.current!, id),
          ),
        )
      }
      return deleted
    } catch (err) {
      await refreshData()
      throw err instanceof Error ? err : new Error("Bulk delete failed")
    }
  }, [refreshData])

  const addEnvelope = useCallback(async (envelope: Omit<Envelope, "id">) => {
    const optimisticId = generateId()
    setState(prev => ({
      ...prev,
      envelopes: [...prev.envelopes, { ...envelope, id: optimisticId }],
    }))

    try {
      const res = await fetch("/api/envelopes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelope),
      })
      if (res.ok) {
        const created = await res.json()
        setState(prev => ({
          ...prev,
          envelopes: prev.envelopes.map(e =>
            e.id === optimisticId ? created : e,
          ),
        }))
      }
    } catch {
      setState(prev => ({
        ...prev,
        envelopes: prev.envelopes.filter(e => e.id !== optimisticId),
      }))
    }
  }, [])

  const editEnvelope = useCallback(async (id: string, updates: Partial<Omit<Envelope, "id">>) => {
    setState(prev => ({
      ...prev,
      envelopes: prev.envelopes.map(e => (e.id === id ? { ...e, ...updates } : e)),
    }))

    try {
      await fetch("/api/envelopes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...updates }),
      })
    } catch {
      refreshData()
    }
  }, [refreshData])

  const archiveEnvelope = useCallback(async (id: string) => {
    const env = envelopesRef.current.find(e => e.id === id)
    if (env?.systemRole === SYSTEM_ENVELOPE_ROLE_SAVINGS) return

    setState(prev => ({
      ...prev,
      envelopes: prev.envelopes.map(e => e.id === id ? { ...e, archived: true } : e),
    }))

    try {
      await fetch("/api/envelopes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, archived: true }),
      })
    } catch {
      refreshData()
    }
  }, [refreshData])

  const restoreEnvelope = useCallback(async (id: string) => {
    setState(prev => ({
      ...prev,
      envelopes: prev.envelopes.map(e => e.id === id ? { ...e, archived: false } : e),
    }))

    try {
      await fetch("/api/envelopes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, archived: false }),
      })
    } catch {
      refreshData()
    }
  }, [refreshData])

  const restoreDeletedEnvelope = useCallback(async (id: string) => {
    setState(prev => ({
      ...prev,
      envelopes: prev.envelopes.map(e => e.id === id ? { ...e, deletedAt: null } : e),
    }))

    try {
      const res = await fetch("/api/envelopes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, deletedAt: null }),
      })
      if (!res.ok) {
        await refreshData()
      }
    } catch {
      await refreshData()
    }
  }, [refreshData])

  const deleteEnvelope = useCallback(async (id: string) => {
    const env = envelopesRef.current.find(e => e.id === id)
    if (env?.systemRole === SYSTEM_ENVELOPE_ROLE_SAVINGS) return

    const deletedAt = new Date().toISOString()
    setState(prev => ({
      ...prev,
      envelopes: prev.envelopes.map(e => (e.id === id ? { ...e, deletedAt } : e)),
    }))

    try {
      const res = await fetch(`/api/envelopes?id=${id}`, { method: "DELETE" })
      if (!res.ok) {
        await refreshData()
      }
    } catch {
      refreshData()
    }
  }, [refreshData])

  const mergeEnvelope = useCallback(async (sourceId: string, targetId: string) => {
    const src = envelopesRef.current.find(e => e.id === sourceId)
    const tgt = envelopesRef.current.find(e => e.id === targetId)
    if (src?.systemRole === SYSTEM_ENVELOPE_ROLE_SAVINGS) return
    if (tgt?.systemRole === SYSTEM_ENVELOPE_ROLE_SAVINGS) return

    setState(prev => ({
      ...prev,
      envelopes: prev.envelopes.filter(e => e.id !== sourceId),
      transactions: prev.transactions.map(t =>
        t.envelopeId === sourceId ? { ...t, envelopeId: targetId } : t,
      ),
    }))

    try {
      await fetch("/api/envelopes/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, targetId }),
      })
      await refreshData()
    } catch {
      refreshData()
    }
  }, [refreshData])

  const setMonthlyIncome = useCallback(async (income: number) => {
    setState(prev => ({ ...prev, monthlyIncome: income }))

    try {
      await fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlyIncome: income }),
      })
    } catch {
      refreshData()
    }
  }, [refreshData])

  const setBtcDisplayUnit = useCallback(async (unit: BtcDisplayUnit) => {
    setState(prev => ({ ...prev, btcDisplayUnit: unit }))
    try {
      await fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ btcDisplayUnit: unit }),
      })
    } catch {
      refreshData()
    }
  }, [refreshData])

  const setOpportunityCostEnabled = useCallback(async (enabled: boolean) => {
    setState(prev => ({ ...prev, opportunityCostEnabled: enabled }))
    try {
      await fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityCostEnabled: enabled }),
      })
    } catch {
      refreshData()
    }
  }, [refreshData])

  const setCommunicationPreference = useCallback(async (
    key: CommunicationPreferenceKey,
    enabled: boolean,
  ) => {
    setState(prev => ({
      ...prev,
      communicationPreferences: {
        ...prev.communicationPreferences,
        [key]: enabled,
      },
    }))
    try {
      const res = await fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [COMMUNICATION_PREFERENCE_COLUMNS[key]]: enabled }),
      })
      if (!res.ok) await refreshData()
    } catch {
      refreshData()
    }
  }, [refreshData])

  const setSavingsExperience = useCallback(async (experience: "engaged" | "dismissed") => {
    setState(prev => ({ ...prev, savingsExperience: experience }))
    try {
      const res = await fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ savingsExperience: experience }),
      })
      if (!res.ok) await refreshData()
    } catch {
      refreshData()
    }
  }, [refreshData])

  const completeWalkthrough = useCallback(async () => {
    setState(prev => ({ ...prev, walkthroughCompleted: true }))
    try {
      const res = await fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walkthroughCompleted: true }),
      })
      if (!res.ok) {
        await refreshData()
      }
    } catch {
      await refreshData()
    }
  }, [refreshData])

  const restartWalkthrough = useCallback(async () => {
    setState(prev => ({ ...prev, walkthroughCompleted: false }))
    try {
      const res = await fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walkthroughCompleted: false }),
      })
      if (!res.ok) await refreshData()
    } catch {
      await refreshData()
    }
  }, [refreshData])

  const updateSetupGuidePrefs = useCallback(
    async (patch: {
      setupGuideSnoozedUntil?: string | null
      setupGuideDismissed?: boolean
      setupGuideShowOnDashboard?: boolean
    }) => {
      setState(prev => ({
        ...prev,
        ...(patch.setupGuideSnoozedUntil !== undefined
          ? { setupGuideSnoozedUntil: patch.setupGuideSnoozedUntil }
          : {}),
        ...(patch.setupGuideDismissed !== undefined
          ? { setupGuideDismissed: patch.setupGuideDismissed }
          : {}),
        ...(patch.setupGuideShowOnDashboard !== undefined
          ? { setupGuideShowOnDashboard: patch.setupGuideShowOnDashboard }
          : {}),
      }))
      try {
        const res = await fetch("/api/user/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        })
        if (!res.ok) await refreshData()
      } catch {
        await refreshData()
      }
    },
    [refreshData],
  )

  const addTag = useCallback(async (tag: string) => {
    const trimmed = tag.trim()
    if (!trimmed) return

    const optimisticId = generateId()
    setState(prev => ({
      ...prev,
      tags: prev.tags.some(t => t.name === trimmed) ? prev.tags : [...prev.tags, { id: optimisticId, name: trimmed }],
    }))

    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      })
      if (res.ok) {
        const created = await res.json() as Tag
        setState(prev => ({
          ...prev,
          tags: prev.tags.map(t => (t.id === optimisticId ? created : t)),
        }))
      } else {
        refreshData()
      }
    } catch {
      refreshData()
    }
  }, [refreshData])

  const deleteTag = useCallback(async (id: string) => {
    setState(prev => ({
      ...prev,
      tags: prev.tags.filter(tag => tag.id !== id),
    }))

    try {
      const res = await fetch(`/api/tags?id=${id}`, { method: "DELETE" })
      if (!res.ok) refreshData()
    } catch {
      refreshData()
    }
  }, [refreshData])

  const openNewTransaction = useCallback((prefill?: TransactionPrefill) => {
    setTransactionPrefill(prefill ?? null)
    setTransactionDialogOpen(true)
  }, [])

  const encryptForStorage = useCallback(async (plaintext: string): Promise<string> => {
    if (!publicKeyRef.current || !plaintext) return plaintext
    return encryptFieldAsymmetric(plaintext, publicKeyRef.current)
  }, [])

  const makeImportDedupeKeyComputer = useCallback((): DedupeKeyComputer | null => {
    const key = privacyKeyRef.current
    if (!key) return null
    try {
      return makeDedupeKeyComputer(uint8ToHex(key))
    } catch {
      return null
    }
  }, [])

  const clearLocalTransactionCache = useCallback(async () => {
    const uid = currentUserIdRef.current
    if (!uid) return
    fullIdbHydratedRef.current = false
    try {
      await clearDb(uid)
    } catch {
      /* Best-effort: IndexedDB delete may be blocked or fail in private mode */
    }
  }, [])

  const logout = useCallback(() => {
    try {
      clearPrivacyKeyCache()
      sessionStorage.removeItem("nostr-login")
      sessionStorage.removeItem("bitbudget-survey-referrer")
      sessionStorage.removeItem("bitbudget-survey-shown")
      sessionStorage.removeItem(DASHBOARD_CHART_RANGE_OVERRIDE_KEY)
      clearAllDrafts()
      clearAllWalletWatches()
    } catch {
      /* ignore */
    }
    clearPendingNsec()
    clearNsecOnboardingIntent()
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.removeItem("bitbudget-nsec")
        localStorage.removeItem("bitbudget-nsec-user")
      } catch {
        /* ignore */
      }
    }
    const uid = currentUserIdRef.current
    privacyKeyRef.current = null
    publicKeyRef.current = null
    currentUserIdRef.current = null
    fullIdbHydratedRef.current = false
    setCurrentUserId(null)
    setMemoTransactionCount(null)
    setTransactionSyncError(null)
    setTxnLoadPhase("init")
    setRecurringTransactions([])
    void (async () => {
      if (uid) await clearDb(uid).catch(() => {})
      signOut({ callbackUrl: "/auth" })
    })()
  }, [])

  const confirmPending = useCallback(async (
    id: string,
    envelopeId?: string,
    updates?: { payee?: string; amount?: number; date?: string; notes?: string | null; tags?: string[] },
  ) => {
    const pt = pendingTransactions.find((p) => p.id === id)
    const payeePlain =
      (typeof updates?.payee === "string" ? updates.payee : pt?.payee)?.trim() || undefined

    const body: Record<string, unknown> = { id, envelopeId, payeePlain }
    if (updates) {
      if (updates.amount !== undefined) body.amount = updates.amount
      if (updates.date !== undefined) body.date = updates.date
      if (updates.tags !== undefined) body.tags = updates.tags
      if (updates.payee !== undefined && publicKeyRef.current) {
        body.payee = encryptFieldAsymmetric(updates.payee.trim(), publicKeyRef.current)
      } else if (updates.payee !== undefined) {
        body.payee = updates.payee.trim()
      }
      if (updates.notes === null) {
        body.notes = null
      } else if (typeof updates.notes === "string" && publicKeyRef.current) {
        body.notes = encryptFieldAsymmetric(updates.notes, publicKeyRef.current)
      } else if (typeof updates.notes === "string") {
        body.notes = updates.notes
      }
    }

    const res = await fetch("/api/pending-transactions/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      setPendingTransactions((prev) => prev.filter((p) => p.id !== id))
      await refreshData()
    }
  }, [refreshData, pendingTransactions])

  const dismissPending = useCallback(async (id: string) => {
    const res = await fetch(`/api/pending-transactions?id=${id}`, { method: "DELETE" })
    if (res.ok) {
      setPendingTransactions(prev => prev.filter(p => p.id !== id))
    }
  }, [])

  const confirmAllPending = useCallback(async () => {
    const withSuggestion = pendingTransactions.filter((p) => p.suggestedEnvelopeId)
    const payeePlainById = Object.fromEntries(
      withSuggestion.map((p) => [p.id, p.payee]),
    ) as Record<string, string>
    const res = await fetch("/api/pending-transactions/confirm-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payeePlainById }),
    })
    if (res.ok) {
      setPendingTransactions((prev) => prev.filter((p) => !p.suggestedEnvelopeId))
      await refreshData()
    }
  }, [refreshData, pendingTransactions])

  const editRecurringTransaction = useCallback(
    async (
      id: string,
      updates: {
        payee?: string
        amount?: number
        type?: "expense" | "credit"
        envelopeId?: string
        cadence?: RecurringTransaction["cadence"]
        endDate?: string | null
        tags?: string[]
        notes?: string | null
      },
    ) => {
      const body: Record<string, unknown> = { id }
      if (updates.amount !== undefined) body.amount = updates.amount
      if (updates.type !== undefined) body.type = updates.type
      if (updates.envelopeId !== undefined) body.envelopeId = updates.envelopeId
      if (updates.cadence !== undefined) body.cadence = updates.cadence
      if (updates.endDate !== undefined) body.endDate = updates.endDate
      if (updates.tags !== undefined) body.tags = updates.tags
      if (updates.payee !== undefined) {
        body.payee = publicKeyRef.current
          ? encryptFieldAsymmetric(updates.payee, publicKeyRef.current)
          : updates.payee
      }
      if (updates.notes !== undefined) {
        body.notes =
          updates.notes !== null && publicKeyRef.current
            ? encryptFieldAsymmetric(updates.notes, publicKeyRef.current)
            : updates.notes
      }
      const res = await fetch("/api/recurring", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errorText = await res.text()
        let message = errorText.trim()
        try {
          const j = JSON.parse(errorText) as { error?: string }
          if (j?.error && typeof j.error === "string") message = j.error
        } catch {
          /* use body as-is */
        }
        throw new Error(
          message || `Failed to edit recurring transaction: ${res.status} ${res.statusText}`,
        )
      }
      const updated = await res.json() as RecurringTransaction
      const locked = pendingLockedRef.current && !privacyKeyRef.current
      const decrypted = decryptRecurringRules([updated], privacyKeyRef.current, locked)[0]
      setRecurringTransactions((prev) =>
        prev.map((r) => (r.id === id ? decrypted : r)),
      )
    },
    [],
  )

  const deleteRecurringTransaction = useCallback(async (id: string) => {
    const res = await fetch(`/api/recurring?id=${encodeURIComponent(id)}`, { method: "DELETE" })
    if (!res.ok) {
      const errorText = await res.text()
      let message = errorText.trim()
      try {
        const j = JSON.parse(errorText) as { error?: string }
        if (j?.error && typeof j.error === "string") message = j.error
      } catch {
        /* use body as-is */
      }
      throw new Error(message || `Failed to delete recurring transaction: ${res.status}`)
    }
    setRecurringTransactions((prev) => prev.filter((r) => r.id !== id))
  }, [])

  const activeEnvelopes = useMemo(
    () => state.envelopes.filter(e => !e.archived && !e.deletedAt),
    [state.envelopes]
  )

  const discretionaryEnvelopes = useMemo(
    () => activeEnvelopes.filter(e => e.systemRole !== SYSTEM_ENVELOPE_ROLE_SAVINGS),
    [activeEnvelopes],
  )

  const activeTransactions = useMemo(
    () => filterTransactionsForActiveLedger(state.transactions, state.envelopes),
    [state.transactions, state.envelopes]
  )

  const loading = txnLoadPhase === "init"
  /** True only after the full sync path (including older API fetch + IDB reconcile) has finished. */
  const historyReady = txnLoadPhase === "synced"

  return (
    <AppContext.Provider
      value={{
        state,
        activeEnvelopes,
        discretionaryEnvelopes,
        activeTransactions,
        currentPage,
        selectedEnvelopeId,
        highlightTransactionId,
        clearHighlightTransactionId: () => setHighlightTransactionId(null),
        transactionDialogOpen,
        transactionPrefill,
        inputModeSheetOpen,
        setInputModeSheetOpen,
        loading,
        txnLoadPhase,
        historyReady,
        transactionSyncError,
        clearTransactionSyncError,
        currentUserId,
        memoTransactionCount,
        encryption,
        unlockWithKey,
        transactionEnvelopeFilter,
        clearTransactionEnvelopeFilter: () => setTransactionEnvelopeFilter(new Set()),
        navigateTo,
        runwayWhatIfUsd,
        setRunwayWhatIf,
        setTransactionDialogOpen,
        openNewTransaction,
        statementImporterOpen,
        statementImporterPrefill,
        statementImporterKey,
        setStatementImporterOpen,
        openStatementImporter,
        addTransaction,
        editTransaction,
        deleteTransaction,
        bulkDeleteTransactions,
        addEnvelope,
        editEnvelope,
        archiveEnvelope,
        restoreEnvelope,
        restoreDeletedEnvelope,
        deleteEnvelope,
        mergeEnvelope,
        setMonthlyIncome,
        setBtcDisplayUnit,
        setOpportunityCostEnabled,
        setCommunicationPreference,
        setSavingsExperience,
        completeWalkthrough,
        restartWalkthrough,
        updateSetupGuidePrefs,
        addTag,
        deleteTag,
        refreshData,
        clearLocalTransactionCache,
        encryptForStorage,
        makeImportDedupeKeyComputer,
        logout,
        isAdmin: userRole === "admin",
        subscriptionTier,
        effectiveTier,
        hasPremiumFeatures: effectiveTier !== "free",
        refereePendingBankLink,
        referralRefereeRedeemed,
        referralRefereeCanRedeem,
        referralRefereeTrialMonths,
        accountCreatedAtIso,
        onboardingCompletedAtIso,
        premiumTrialUntilIso,
        premiumGratisUntilIso,
        premiumRenewalPrompt,
        premiumExpiredBanner,
        dismissPremiumRenewalUi,
        referralSummary,
        pendingTransactions,
        pendingCount: pendingTransactions.length,
        confirmPending,
        dismissPending,
        confirmAllPending,
        recurringTransactions,
        editRecurringTransaction,
        deleteRecurringTransaction,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}
