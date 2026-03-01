"use client"

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react"
import { signOut } from "next-auth/react"
import type { Transaction, Envelope, AppState, BtcDisplayUnit } from "@/lib/data"
import { generateId, getDefaultState } from "@/lib/data"
import { encryptField, decryptField, hexToUint8 } from "@/lib/crypto"

export type PageId =
  | "dashboard"
  | "analytics"
  | "envelopes"
  | "envelope-detail"
  | "transactions"
  | "btc-price"
  | "researcher"
  | "funds"
  | "settings"

function pageToHash(page: PageId, envelopeId?: string | null): string {
  if (page === "envelope-detail" && envelopeId) return `#/envelope/${envelopeId}`
  return `#/${page}`
}

function hashToPage(hash: string): { page: PageId; envelopeId?: string } {
  const path = hash.replace(/^#\/?/, "")
  if (!path || path === "/") return { page: "dashboard" }

  const envelopeMatch = path.match(/^envelope\/(.+)$/)
  if (envelopeMatch) return { page: "envelope-detail", envelopeId: envelopeMatch[1] }

  const validPages: PageId[] = ["dashboard", "analytics", "envelopes", "transactions", "researcher", "funds", "settings"]
  if (validPages.includes(path as PageId)) return { page: path as PageId }

  return { page: "dashboard" }
}

interface EncryptionState {
  ready: boolean
  needsPinUnlock: boolean
  encryptedPrivacyKey: string | null
  privacyKeySalt: string | null
}

interface AppContextValue {
  state: AppState
  currentPage: PageId
  selectedEnvelopeId: string | null
  highlightTransactionId: string | null
  transactionDialogOpen: boolean
  loading: boolean
  encryption: EncryptionState
  unlockWithKey: (key: Uint8Array) => void

  navigateTo: (page: PageId, envelopeId?: string, opts?: { highlightTxnId?: string }) => void
  setTransactionDialogOpen: (open: boolean) => void

  addTransaction: (txn: Omit<Transaction, "id">) => void
  editTransaction: (id: string, updates: Partial<Omit<Transaction, "id">>) => void
  deleteTransaction: (id: string) => void

  addEnvelope: (envelope: Omit<Envelope, "id">) => void
  editEnvelope: (id: string, updates: Partial<Omit<Envelope, "id">>) => void
  deleteEnvelope: (id: string) => void

  setMonthlyIncome: (income: number) => void
  setBtcDisplayUnit: (unit: BtcDisplayUnit) => void
  addTag: (tag: string) => void
  refreshData: () => Promise<void>
  encryptForStorage: (plaintext: string) => Promise<string>
  logout: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useApp must be used within AppProvider")
  return ctx
}

async function decryptTransactions(transactions: Transaction[], key: Uint8Array): Promise<Transaction[]> {
  return Promise.all(transactions.map(async (t) => {
    try {
      const payee = await decryptField(t.payee, key)
      const notes = t.notes ? await decryptField(t.notes, key) : t.notes
      return { ...t, payee, notes }
    } catch {
      return t
    }
  }))
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(getDefaultState)
  const [currentPage, setCurrentPage] = useState<PageId>(() => {
    if (typeof window === "undefined") return "dashboard"
    return hashToPage(window.location.hash).page
  })
  const [selectedEnvelopeId, setSelectedEnvelopeId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null
    return hashToPage(window.location.hash).envelopeId ?? null
  })
  const [highlightTransactionId, setHighlightTransactionId] = useState<string | null>(null)
  const [transactionDialogOpen, setTransactionDialogOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const mounted = useRef(false)
  const isPopstate = useRef(false)

  const privacyKeyRef = useRef<Uint8Array | null>(null)
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
        setEncryption({ ready: true, needsPinUnlock: false, encryptedPrivacyKey: null, privacyKeySalt: null })
        return
      }

      const cachedKey = sessionStorage.getItem("bitbudget-privacy-key")
      const cachedUser = sessionStorage.getItem("bitbudget-privacy-user")
      if (cachedKey && cachedUser === data.userId) {
        privacyKeyRef.current = hexToUint8(cachedKey)
        setEncryption({ ready: true, needsPinUnlock: false, encryptedPrivacyKey: null, privacyKeySalt: null })
        return
      }

      if (cachedUser !== data.userId) {
        sessionStorage.removeItem("bitbudget-privacy-key")
        sessionStorage.removeItem("bitbudget-privacy-user")
      }

      if (data.isNostr && data.nostrPubkey) {
        const nostrExt = (window as unknown as {
          nostr?: { nip04?: { decrypt: (pubkey: string, ciphertext: string) => Promise<string> } }
        }).nostr

        if (nostrExt?.nip04) {
          try {
            const hexKey = await nostrExt.nip04.decrypt(data.nostrPubkey, data.encryptedPrivacyKey)
            privacyKeyRef.current = hexToUint8(hexKey)
            sessionStorage.setItem("bitbudget-privacy-key", hexKey)
            sessionStorage.setItem("bitbudget-privacy-user", data.userId)
            setEncryption({ ready: true, needsPinUnlock: false, encryptedPrivacyKey: null, privacyKeySalt: null })
            return
          } catch { /* fall through to show unlock needed */ }
        }
      }

      setEncryption({
        ready: false,
        needsPinUnlock: true,
        encryptedPrivacyKey: data.encryptedPrivacyKey,
        privacyKeySalt: data.privacyKeySalt,
      })
    } catch {
      setEncryption({ ready: true, needsPinUnlock: false, encryptedPrivacyKey: null, privacyKeySalt: null })
    }
  }, [])

  const unlockWithKey = useCallback((key: Uint8Array) => {
    privacyKeyRef.current = key
    if (currentUserIdRef.current) {
      sessionStorage.setItem("bitbudget-privacy-user", currentUserIdRef.current)
    }
    setEncryption({ ready: true, needsPinUnlock: false, encryptedPrivacyKey: null, privacyKeySalt: null })
  }, [])

  const refreshData = useCallback(async () => {
    try {
      await fetch("/api/recurring/process", { method: "POST" }).catch(() => {})

      const [txnRes, envRes, settingsRes] = await Promise.all([
        fetch("/api/transactions"),
        fetch("/api/envelopes"),
        fetch("/api/user/settings"),
      ])

      if (!txnRes.ok || !envRes.ok || !settingsRes.ok) {
        throw new Error("Failed to fetch data")
      }

      let [transactions, envelopes, settings] = await Promise.all([
        txnRes.json() as Promise<Transaction[]>,
        envRes.json(),
        settingsRes.json(),
      ])

      if (privacyKeyRef.current) {
        transactions = await decryptTransactions(transactions, privacyKeyRef.current)
      }

      setState(prev => ({
        ...prev,
        transactions,
        envelopes,
        monthlyIncome: settings.monthlyIncome || 0,
        btcDisplayUnit: settings.btcDisplayUnit || "sats",
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

  const navigateTo = useCallback((page: PageId, envelopeId?: string, opts?: { highlightTxnId?: string }) => {
    setCurrentPage(page)
    if (envelopeId) setSelectedEnvelopeId(envelopeId)
    setHighlightTransactionId(opts?.highlightTxnId ?? null)

    if (!isPopstate.current) {
      const hash = pageToHash(page, envelopeId)
      if (window.location.hash !== hash) {
        window.history.pushState({ page, envelopeId }, "", hash)
      }
    }
    isPopstate.current = false
  }, [])

  useEffect(() => {
    function onPopState() {
      const { page, envelopeId } = hashToPage(window.location.hash)
      isPopstate.current = true
      setCurrentPage(page)
      if (envelopeId) setSelectedEnvelopeId(envelopeId)
    }

    window.addEventListener("popstate", onPopState)

    if (!window.location.hash) {
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
      if (privacyKeyRef.current) {
        payload.payee = await encryptField(txn.payee, privacyKeyRef.current)
        if (payload.notes) payload.notes = await encryptField(payload.notes, privacyKeyRef.current)
      }

      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        const created = await res.json()
        if (privacyKeyRef.current) {
          created.payee = await decryptField(created.payee, privacyKeyRef.current)
          if (created.notes) created.notes = await decryptField(created.notes, privacyKeyRef.current)
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
      if (privacyKeyRef.current) {
        if (typeof payload.payee === "string") payload.payee = await encryptField(payload.payee as string, privacyKeyRef.current)
        if (typeof payload.notes === "string") payload.notes = await encryptField(payload.notes as string, privacyKeyRef.current)
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

  const addTag = useCallback((tag: string) => {
    setState(prev => ({
      ...prev,
      tags: prev.tags.includes(tag) ? prev.tags : [...prev.tags, tag],
    }))
  }, [])

  const encryptForStorage = useCallback(async (plaintext: string): Promise<string> => {
    if (!privacyKeyRef.current || !plaintext) return plaintext
    return encryptField(plaintext, privacyKeyRef.current)
  }, [])

  const logout = useCallback(() => {
    sessionStorage.removeItem("bitbudget-privacy-key")
    sessionStorage.removeItem("bitbudget-privacy-user")
    privacyKeyRef.current = null
    currentUserIdRef.current = null
    signOut({ callbackUrl: "/auth" })
  }, [])

  return (
    <AppContext.Provider
      value={{
        state,
        currentPage,
        selectedEnvelopeId,
        highlightTransactionId,
        transactionDialogOpen,
        loading,
        encryption,
        unlockWithKey,
        navigateTo,
        setTransactionDialogOpen,
        addTransaction,
        editTransaction,
        deleteTransaction,
        addEnvelope,
        editEnvelope,
        deleteEnvelope,
        setMonthlyIncome,
        setBtcDisplayUnit,
        addTag,
        refreshData,
        encryptForStorage,
        logout,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}
