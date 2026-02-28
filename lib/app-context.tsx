"use client"

import React, { createContext, useContext, useState, useCallback, useEffect } from "react"
import {
  type AppState,
  type Transaction,
  type Envelope,
  loadState,
  saveState,
  getDefaultState,
  generateId,
} from "@/lib/data"

// ─── Page routing ────────────────────────────────────────────────────

export type PageId =
  | "dashboard"
  | "analytics"
  | "envelopes"
  | "envelope-detail"
  | "researcher"
  | "funds"

// ─── Context shape ───────────────────────────────────────────────────

interface AppContextValue {
  state: AppState
  currentPage: PageId
  selectedEnvelopeId: string | null
  transactionDialogOpen: boolean

  // Navigation
  navigateTo: (page: PageId, envelopeId?: string) => void
  setTransactionDialogOpen: (open: boolean) => void

  // Transaction actions
  addTransaction: (txn: Omit<Transaction, "id">) => void
  deleteTransaction: (id: string) => void

  // Envelope actions
  addEnvelope: (envelope: Omit<Envelope, "id">) => void
  editEnvelope: (id: string, updates: Partial<Omit<Envelope, "id">>) => void
  deleteEnvelope: (id: string) => void

  // Settings
  setMonthlyIncome: (income: number) => void
  addTag: (tag: string) => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useApp must be used within AppProvider")
  return ctx
}

// ─── Provider ────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(getDefaultState)
  const [hydrated, setHydrated] = useState(false)
  const [currentPage, setCurrentPage] = useState<PageId>("dashboard")
  const [selectedEnvelopeId, setSelectedEnvelopeId] = useState<string | null>(null)
  const [transactionDialogOpen, setTransactionDialogOpen] = useState(false)

  // Hydrate from localStorage on mount
  useEffect(() => {
    setState(loadState())
    setHydrated(true)
  }, [])

  // Persist to localStorage on state changes (after hydration)
  useEffect(() => {
    if (hydrated) {
      saveState(state)
    }
  }, [state, hydrated])

  const navigateTo = useCallback((page: PageId, envelopeId?: string) => {
    setCurrentPage(page)
    if (envelopeId) setSelectedEnvelopeId(envelopeId)
  }, [])

  // ─── Transaction actions ─────────────────────────────────────────

  const addTransaction = useCallback((txn: Omit<Transaction, "id">) => {
    setState((prev) => ({
      ...prev,
      transactions: [{ ...txn, id: generateId() }, ...prev.transactions],
    }))
  }, [])

  const deleteTransaction = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      transactions: prev.transactions.filter((t) => t.id !== id),
    }))
  }, [])

  // ─── Envelope actions ────────────────────────────────────────────

  const addEnvelope = useCallback((envelope: Omit<Envelope, "id">) => {
    setState((prev) => ({
      ...prev,
      envelopes: [...prev.envelopes, { ...envelope, id: generateId() }],
    }))
  }, [])

  const editEnvelope = useCallback((id: string, updates: Partial<Omit<Envelope, "id">>) => {
    setState((prev) => ({
      ...prev,
      envelopes: prev.envelopes.map((e) => (e.id === id ? { ...e, ...updates } : e)),
    }))
  }, [])

  const deleteEnvelope = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      envelopes: prev.envelopes.filter((e) => e.id !== id),
      // Also remove transactions associated with this envelope
      transactions: prev.transactions.filter((t) => t.envelopeId !== id),
    }))
  }, [])

  // ─── Settings ────────────────────────────────────────────────────

  const setMonthlyIncome = useCallback((income: number) => {
    setState((prev) => ({ ...prev, monthlyIncome: income }))
  }, [])

  const addTag = useCallback((tag: string) => {
    setState((prev) => ({
      ...prev,
      tags: prev.tags.includes(tag) ? prev.tags : [...prev.tags, tag],
    }))
  }, [])

  return (
    <AppContext.Provider
      value={{
        state,
        currentPage,
        selectedEnvelopeId,
        transactionDialogOpen,
        navigateTo,
        setTransactionDialogOpen,
        addTransaction,
        deleteTransaction,
        addEnvelope,
        editEnvelope,
        deleteEnvelope,
        setMonthlyIncome,
        addTag,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}
