"use client"

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react"
import type { Transaction, Envelope, AppState } from "@/lib/data"
import { generateId, getDefaultState } from "@/lib/data"

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

interface AppContextValue {
  state: AppState
  currentPage: PageId
  selectedEnvelopeId: string | null
  transactionDialogOpen: boolean
  loading: boolean

  navigateTo: (page: PageId, envelopeId?: string) => void
  setTransactionDialogOpen: (open: boolean) => void

  addTransaction: (txn: Omit<Transaction, "id">) => void
  editTransaction: (id: string, updates: Partial<Omit<Transaction, "id">>) => void
  deleteTransaction: (id: string) => void

  addEnvelope: (envelope: Omit<Envelope, "id">) => void
  editEnvelope: (id: string, updates: Partial<Omit<Envelope, "id">>) => void
  deleteEnvelope: (id: string) => void

  setMonthlyIncome: (income: number) => void
  addTag: (tag: string) => void
  refreshData: () => Promise<void>
  importCSV: (file: File) => Promise<{ imported: number; skipped: number; newEnvelopes: string[] }>
}

const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useApp must be used within AppProvider")
  return ctx
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
  const [transactionDialogOpen, setTransactionDialogOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const mounted = useRef(false)
  const isPopstate = useRef(false)

  const refreshData = useCallback(async () => {
    try {
      // Process any due recurring transactions before fetching data
      await fetch("/api/recurring/process", { method: "POST" }).catch(() => {})

      const [txnRes, envRes, settingsRes] = await Promise.all([
        fetch("/api/transactions"),
        fetch("/api/envelopes"),
        fetch("/api/user/settings"),
      ])

      if (!txnRes.ok || !envRes.ok || !settingsRes.ok) {
        throw new Error("Failed to fetch data")
      }

      const [transactions, envelopes, settings] = await Promise.all([
        txnRes.json(),
        envRes.json(),
        settingsRes.json(),
      ])

      setState(prev => ({
        ...prev,
        transactions,
        envelopes,
        monthlyIncome: settings.monthlyIncome || 0,
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
      refreshData()
    }
  }, [refreshData])

  const navigateTo = useCallback((page: PageId, envelopeId?: string) => {
    setCurrentPage(page)
    if (envelopeId) setSelectedEnvelopeId(envelopeId)

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
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(txn),
      })
      if (res.ok) {
        const created = await res.json()
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
      await fetch("/api/transactions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...updates }),
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

  const addTag = useCallback((tag: string) => {
    setState(prev => ({
      ...prev,
      tags: prev.tags.includes(tag) ? prev.tags : [...prev.tags, tag],
    }))
  }, [])

  const importCSV = useCallback(async (file: File) => {
    const formData = new FormData()
    formData.append("file", file)
    const res = await fetch("/api/import", { method: "POST", body: formData })
    const result = await res.json()
    await refreshData()
    return result
  }, [refreshData])

  return (
    <AppContext.Provider
      value={{
        state,
        currentPage,
        selectedEnvelopeId,
        transactionDialogOpen,
        loading,
        navigateTo,
        setTransactionDialogOpen,
        addTransaction,
        editTransaction,
        deleteTransaction,
        addEnvelope,
        editEnvelope,
        deleteEnvelope,
        setMonthlyIncome,
        addTag,
        refreshData,
        importCSV,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}
