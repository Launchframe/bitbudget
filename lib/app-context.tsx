"use client"

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react"
import { signOut } from "next-auth/react"
import type { Transaction, Envelope, AppState, BtcDisplayUnit, PendingTransaction, Tag } from "@/lib/data"
import { generateId, getDefaultState } from "@/lib/data"
import {
  encryptFieldAsymmetric,
  decryptFieldAsymmetric,
  generateKeyPairFromSeed,
  hexToUint8,
  uint8ToHex,
  looksEncrypted,
} from "@/lib/crypto"
import { syncUserPublicKey } from "@/lib/sync-user-public-key"
import { clearPendingNsec, clearNsecOnboardingIntent, getPendingNsec } from "@/lib/nostr-local-signer"

export type PageId =
  | "dashboard"
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

  const validPages: PageId[] = ["dashboard", "analytics", "envelopes", "transactions", "btc-price", "researcher", "funds", "profile", "settings", "review-inbox"]
  if (validPages.includes(path as PageId)) return { page: path as PageId }

  return { page: "dashboard" }
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
}

interface AppContextValue {
  state: AppState
  activeEnvelopes: Envelope[]
  activeTransactions: Transaction[]
  currentPage: PageId
  selectedEnvelopeId: string | null
  highlightTransactionId: string | null
  transactionDialogOpen: boolean
  transactionPrefill: TransactionPrefill | null
  inputModeSheetOpen: boolean
  setInputModeSheetOpen: (open: boolean) => void
  loading: boolean
  encryption: EncryptionState
  unlockWithKey: (key: Uint8Array) => void

  transactionEnvelopeFilter: Set<string>
  clearTransactionEnvelopeFilter: () => void
  navigateTo: (page: PageId, envelopeId?: string, opts?: { highlightTxnId?: string; envelopeFilter?: string; openAllocations?: boolean }) => void
  setTransactionDialogOpen: (open: boolean) => void
  openNewTransaction: (prefill?: TransactionPrefill) => void

  addTransaction: (txn: Omit<Transaction, "id">) => void
  editTransaction: (id: string, updates: Partial<Omit<Transaction, "id">>) => void
  deleteTransaction: (id: string) => void

  addEnvelope: (envelope: Omit<Envelope, "id">) => void
  editEnvelope: (id: string, updates: Partial<Omit<Envelope, "id">>) => void
  archiveEnvelope: (id: string) => void
  restoreEnvelope: (id: string) => void
  deleteEnvelope: (id: string) => void
  mergeEnvelope: (sourceId: string, targetId: string) => Promise<void>

  setMonthlyIncome: (income: number) => void
  setBtcDisplayUnit: (unit: BtcDisplayUnit) => void
  setOpportunityCostEnabled: (enabled: boolean) => void
  addTag: (tag: string) => void
  deleteTag: (id: string) => void
  refreshData: () => Promise<void>
  encryptForStorage: (plaintext: string) => Promise<string>
  logout: () => void
  isAdmin: boolean
  subscriptionTier: "free" | "premium"

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
}

const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useApp must be used within AppProvider")
  return ctx
}

const ENCRYPTED_PLACEHOLDER = "(encrypted)"

function decryptTxnLikeRecords<T extends { payee: string; notes?: string | null }>(
  records: T[],
  secretKey: Uint8Array,
): T[] {
  return records.map((t) => {
    let payee = t.payee
    let notes = t.notes
    try {
      payee = decryptFieldAsymmetric(t.payee, secretKey)
    } catch {
      if (looksEncrypted(t.payee)) payee = ENCRYPTED_PLACEHOLDER
    }
    if (t.notes) {
      try {
        notes = decryptFieldAsymmetric(t.notes, secretKey)
      } catch {
        if (looksEncrypted(t.notes)) notes = ENCRYPTED_PLACEHOLDER
      }
    }
    return { ...t, payee, notes }
  })
}

/** Mask fields that are still ciphertext when we have no key to decrypt them. */
function maskEncryptedRecords<T extends { payee: string; notes?: string | null }>(
  records: T[],
): T[] {
  return records.map((t) => ({
    ...t,
    payee: looksEncrypted(t.payee) ? ENCRYPTED_PLACEHOLDER : t.payee,
    notes: t.notes && looksEncrypted(t.notes) ? ENCRYPTED_PLACEHOLDER : t.notes,
  }))
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
    return page === "envelope-detail" ? "transactions" : page
  })
  const [selectedEnvelopeId, setSelectedEnvelopeId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null
    return hashToPage(window.location.hash).envelopeId ?? null
  })
  const [highlightTransactionId, setHighlightTransactionId] = useState<string | null>(null)
  const [transactionDialogOpen, setTransactionDialogOpen] = useState(false)
  const [transactionPrefill, setTransactionPrefill] = useState<TransactionPrefill | null>(null)
  const [inputModeSheetOpen, setInputModeSheetOpen] = useState(false)
  const [transactionEnvelopeFilter, setTransactionEnvelopeFilter] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set()
    const { page, envelopeId } = hashToPage(window.location.hash)
    return page === "envelope-detail" && envelopeId ? new Set([envelopeId]) : new Set()
  })
  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [subscriptionTier, setSubscriptionTier] = useState<"free" | "premium">("free")
  const [pendingTransactions, setPendingTransactions] = useState<PendingTransaction[]>([])
  const mounted = useRef(false)
  const isPopstate = useRef(false)

  const privacyKeyRef = useRef<Uint8Array | null>(null)
  const publicKeyRef = useRef<Uint8Array | null>(null)
  /** True while user has wrapped privacy key but has not unlocked this session (avoid showing encrypted pending as gibberish). */
  const pendingLockedRef = useRef(false)
  const currentUserIdRef = useRef<string | null>(null)
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

      if (!data.encryptedPrivacyKey) {
        pendingLockedRef.current = false
        setEncryption({ ready: true, needsPinUnlock: false, encryptedPrivacyKey: null, privacyKeySalt: null })
        return
      }

      const cachedKey = sessionStorage.getItem("bitbudget-privacy-key")
      const cachedUser = sessionStorage.getItem("bitbudget-privacy-user")
      if (cachedKey && cachedUser === data.userId) {
        const pk = hexToUint8(cachedKey)
        privacyKeyRef.current = pk
        applyPrivacyKey(pk, publicKeyRef)
        void syncUserPublicKey(pk)
        pendingLockedRef.current = false
        setEncryption({ ready: true, needsPinUnlock: false, encryptedPrivacyKey: null, privacyKeySalt: null })
        return
      }

      if (cachedUser !== data.userId) {
        sessionStorage.removeItem("bitbudget-privacy-key")
        sessionStorage.removeItem("bitbudget-privacy-user")
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
            sessionStorage.setItem("bitbudget-privacy-key", hexKey)
            sessionStorage.setItem("bitbudget-privacy-user", data.userId)
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
            sessionStorage.setItem("bitbudget-privacy-key", hexKey)
            sessionStorage.setItem("bitbudget-privacy-user", data.userId)
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

  const unlockWithKey = useCallback((key: Uint8Array) => {
    privacyKeyRef.current = key
    applyPrivacyKey(key, publicKeyRef)
    void syncUserPublicKey(key)
    pendingLockedRef.current = false
    if (currentUserIdRef.current) {
      try {
        sessionStorage.setItem("bitbudget-privacy-key", uint8ToHex(key))
        sessionStorage.setItem("bitbudget-privacy-user", currentUserIdRef.current)
      } catch {
        /* private mode / quota */
      }
    }
    setEncryption({ ready: true, needsPinUnlock: false, encryptedPrivacyKey: null, privacyKeySalt: null })
  }, [])

  const refreshData = useCallback(async () => {
    try {
      await fetch("/api/recurring/process", { method: "POST" }).catch(() => {})

      const [txnRes, envRes, settingsRes, pendingRes, tagsRes] = await Promise.all([
        fetch("/api/transactions"),
        fetch("/api/envelopes"),
        fetch("/api/user/settings"),
        fetch("/api/pending-transactions"),
        fetch("/api/tags"),
      ])

      const authFailure = [txnRes, envRes, settingsRes, tagsRes].some(
        (r) => r.status === 401 || r.status === 403,
      )
      if (authFailure) {
        signOut({ callbackUrl: "/auth" })
        return
      }
      if (!txnRes.ok || !envRes.ok || !settingsRes.ok) {
        throw new Error("Failed to fetch data")
      }

      if (pendingRes.ok) {
        if (pendingLockedRef.current && !privacyKeyRef.current) {
          setPendingTransactions([])
        } else {
          let pendingData: PendingTransaction[] = await pendingRes.json()
          if (privacyKeyRef.current) {
            pendingData = decryptTxnLikeRecords(pendingData, privacyKeyRef.current)
          } else {
            pendingData = maskEncryptedRecords(pendingData)
          }
          setPendingTransactions(pendingData)
        }
      }
      if (!tagsRes.ok) throw new Error("Failed to fetch tags")

      const [txns, envelopes, settings] = await Promise.all([
        txnRes.json() as Promise<Transaction[]>,
        envRes.json(),
        settingsRes.json(),
      ])
      let transactions = txns
      const tags = await tagsRes.json() as Tag[]

      if (privacyKeyRef.current) {
        transactions = decryptTxnLikeRecords(transactions, privacyKeyRef.current)
      } else {
        transactions = maskEncryptedRecords(transactions)
      }

      setUserRole(settings.role ?? null)
      setSubscriptionTier(
        settings.subscriptionTier === "premium" ? "premium" : "free",
      )
      setState(prev => ({
        ...prev,
        transactions,
        envelopes,
        tags,
        monthlyIncome: settings.monthlyIncome || 0,
        btcDisplayUnit: settings.btcDisplayUnit || "sats",
        opportunityCostEnabled: settings.opportunityCostEnabled ?? false,
      }))
    } catch {
      // On error, keep current state (may be default/empty)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      initEncryption().then(() => refreshData())
    }
  }, [initEncryption, refreshData])

  useEffect(() => {
    if (encryption.ready && privacyKeyRef.current && mounted.current) {
      refreshData()
    }
  }, [encryption.ready, refreshData])

  const navigateTo = useCallback((page: PageId, envelopeId?: string, opts?: { highlightTxnId?: string; envelopeFilter?: string; openAllocations?: boolean }) => {
    const targetPage = page === "envelopes" && opts?.openAllocations ? "envelope-allocations" : page
    setCurrentPage(targetPage)
    if (envelopeId) setSelectedEnvelopeId(envelopeId)
    setHighlightTransactionId(opts?.highlightTxnId ?? null)
    if (opts?.envelopeFilter) setTransactionEnvelopeFilter(new Set([opts.envelopeFilter]))

    if (!isPopstate.current) {
      const hash = pageToHash(targetPage, envelopeId)
      if (window.location.hash !== hash) {
        window.history.pushState({ page: targetPage, envelopeId }, "", hash)
      }
    }
    isPopstate.current = false
  }, [])

  useEffect(() => {
    function onPopState() {
      const { page, envelopeId } = hashToPage(window.location.hash)
      isPopstate.current = true
      if (page === "envelope-detail" && envelopeId) {
        setCurrentPage("transactions")
        setTransactionEnvelopeFilter(new Set([envelopeId]))
        window.history.replaceState({ page: "transactions" }, "", "#/transactions")
      } else {
        setCurrentPage(page)
        if (envelopeId) setSelectedEnvelopeId(envelopeId)
      }
    }

    window.addEventListener("popstate", onPopState)

    // Redirect initial envelope-detail URLs (e.g. direct link or old bookmark)
    const initial = hashToPage(window.location.hash)
    if (initial.page === "envelope-detail" && initial.envelopeId) {
      setCurrentPage("transactions")
      setTransactionEnvelopeFilter(new Set([initial.envelopeId]))
      window.history.replaceState({ page: "transactions" }, "", "#/transactions")
    } else if (!window.location.hash) {
      window.history.replaceState({ page: "dashboard" }, "", "#/dashboard")
    }

    return () => window.removeEventListener("popstate", onPopState)
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
        const created = await res.json()
        if (privacyKeyRef.current) {
          try {
            created.payee = decryptFieldAsymmetric(created.payee, privacyKeyRef.current)
          } catch { /* plaintext */ }
          if (created.notes) {
            try {
              created.notes = decryptFieldAsymmetric(created.notes, privacyKeyRef.current)
            } catch { /* keep */ }
          }
        }
        setState(prev => ({
          ...prev,
          transactions: prev.transactions.map(t =>
            t.id === optimisticId ? created : t,
          ),
        }))
      }
    } catch {
      setState(prev => ({
        ...prev,
        transactions: prev.transactions.filter(t => t.id !== optimisticId),
      }))
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

      await fetch("/api/transactions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    } catch {
      refreshData()
    }
  }, [refreshData])

  const deleteTransaction = useCallback(async (id: string) => {
    setState(prev => ({
      ...prev,
      transactions: prev.transactions.filter(t => t.id !== id),
    }))

    try {
      await fetch(`/api/transactions?id=${id}`, { method: "DELETE" })
    } catch {
      refreshData()
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

  const deleteEnvelope = useCallback(async (id: string) => {
    setState(prev => ({
      ...prev,
      envelopes: prev.envelopes.filter(e => e.id !== id),
      transactions: prev.transactions.filter(t => t.envelopeId !== id),
    }))

    try {
      await fetch(`/api/envelopes?id=${id}`, { method: "DELETE" })
    } catch {
      refreshData()
    }
  }, [refreshData])

  const mergeEnvelope = useCallback(async (sourceId: string, targetId: string) => {
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

  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem("bitbudget-privacy-key")
      sessionStorage.removeItem("bitbudget-privacy-user")
      sessionStorage.removeItem("nostr-login")
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
    privacyKeyRef.current = null
    publicKeyRef.current = null
    currentUserIdRef.current = null
    signOut({ callbackUrl: "/auth" })
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

  const activeEnvelopes = useMemo(
    () => state.envelopes.filter(e => !e.archived),
    [state.envelopes]
  )

  const archivedEnvelopeIds = useMemo(
    () => new Set(state.envelopes.filter(e => e.archived).map(e => e.id)),
    [state.envelopes]
  )

  const activeTransactions = useMemo(
    () => state.transactions.filter(t => !archivedEnvelopeIds.has(t.envelopeId)),
    [state.transactions, archivedEnvelopeIds]
  )

  return (
    <AppContext.Provider
      value={{
        state,
        activeEnvelopes,
        activeTransactions,
        currentPage,
        selectedEnvelopeId,
        highlightTransactionId,
        transactionDialogOpen,
        transactionPrefill,
        inputModeSheetOpen,
        setInputModeSheetOpen,
        loading,
        encryption,
        unlockWithKey,
        transactionEnvelopeFilter,
        clearTransactionEnvelopeFilter: () => setTransactionEnvelopeFilter(new Set()),
        navigateTo,
        setTransactionDialogOpen,
        openNewTransaction,
        addTransaction,
        editTransaction,
        deleteTransaction,
        addEnvelope,
        editEnvelope,
        archiveEnvelope,
        restoreEnvelope,
        deleteEnvelope,
        mergeEnvelope,
        setMonthlyIncome,
        setBtcDisplayUnit,
        setOpportunityCostEnabled,
        addTag,
        deleteTag,
        refreshData,
        encryptForStorage,
        logout,
        isAdmin: userRole === "admin",
        subscriptionTier,
        pendingTransactions,
        pendingCount: pendingTransactions.length,
        confirmPending,
        dismissPending,
        confirmAllPending,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}
