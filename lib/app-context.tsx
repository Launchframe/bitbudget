"use client"

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react"
import type { Transaction, Envelope, AppState } from "@/lib/data"
import { generateId, getDefaultState } from "@/lib/data"

export type PageId =
  | "dashboard"
  | "analytics"
  | "envelopes"
  | "envelope-detail"
  | "researcher"
  | "funds"
  | "settings"

interface AppContextValue {
  state: AppState
  currentPage: PageId
  selectedEnvelopeId: string | null
  transactionDialogOpen: boolean
  loading: boolean

  navigateTo: (page: PageId, envelopeId?: string) => void
  setTransactionDialogOpen: (open: boolean) => void

  addTransaction: (txn: Omit<Transaction, "id">) => void
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
  const [currentPage, setCurrentPage] = useState<PageId>("dashboard")
  const [selectedEnvelopeId, setSelectedEnvelopeId] = useState<string | null>(null)
  const [transactionDialogOpen, setTransactionDialogOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const mounted = useRef(false)

  const refreshData = useCallback(async () => {
    try {
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
