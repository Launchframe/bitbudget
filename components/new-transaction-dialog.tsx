"use client"

import { useState, useMemo, useRef, useEffect, useCallback } from "react"
import { useApp } from "@/lib/app-context"
import type { TransactionType, Transaction } from "@/lib/data"
import { formatUsdPrecise } from "@/lib/data"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { X, Repeat, Tag, ChevronRight } from "lucide-react"
import { ShortcutsPanel, useTransactionShortcuts } from "@/components/shortcuts-panel"
import {
  mergePayeeCandidates,
  normalizePayeeKey,
  resolveCanonicalPayee,
  type CanonicalMatchReason,
  type PayeeAliasRule,
  type PayeeCandidate,
} from "@/lib/payee-canonical"
import { findCollidingTransaction } from "@/lib/transaction-dedup"

type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual"

const CADENCE_OPTIONS: { value: Cadence; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annual" },
]

function bestEnvelopeIdForPayee(
  payeeDisplay: string,
  payeeIndex: Map<string, Map<string, number>>,
  activeEnvelopes: { id: string }[],
): string {
  const key = payeeDisplay.toLowerCase()
  const envCounts = payeeIndex.get(key)
  if (!envCounts) return ""
  let best = ""
  let bestC = 0
  for (const [id, c] of envCounts) {
    if (c > bestC) {
      bestC = c
      best = id
    }
  }
  if (best && activeEnvelopes.some((e) => e.id === best)) return best
  return ""
}

export function NewTransactionDialog() {
  const {
    state,
    activeEnvelopes,
    activeTransactions,
    transactionDialogOpen,
    transactionPrefill,
    setTransactionDialogOpen,
    addTransaction,
    addTag,
    refreshData,
    encryptForStorage,
  } = useApp()
  const shortcuts = useTransactionShortcuts(transactionDialogOpen)

  const [type, setType] = useState<TransactionType>("expense")
  const [payee, setPayee] = useState("")
  const [amount, setAmount] = useState("")
  const [envelopeId, setEnvelopeId] = useState("")
  const [date, setDate] = useState(new Date().toISOString().split("T")[0])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [newTag, setNewTag] = useState("")
  const [notes, setNotes] = useState("")

  const [isRecurring, setIsRecurring] = useState(false)
  const [cadence, setCadence] = useState<Cadence>("monthly")
  const [endDate, setEndDate] = useState("")
  const [saveAsShortcut, setSaveAsShortcut] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const [duplicateExisting, setDuplicateExisting] = useState<Transaction | null>(null)
  const [payeeMatchHint, setPayeeMatchHint] = useState<{
    original: string
    canonical: string
    reason: CanonicalMatchReason
  } | null>(null)
  const [payeeAliasRules, setPayeeAliasRules] = useState<PayeeAliasRule[]>([])
  const [importSourcePayee, setImportSourcePayee] = useState<string | null>(null)
  const [aliasSaveBusy, setAliasSaveBusy] = useState(false)
  const [aliasSaveMessage, setAliasSaveMessage] = useState<string | null>(null)

  type ModalView = "main" | "recurring" | "tags"
  const [modalView, setModalView] = useState<ModalView>("main")

  const recurringSnapshotRef = useRef({ isRecurring: false, cadence: "monthly" as Cadence, endDate: "" })
  const tagsSnapshotRef = useRef<string[]>([])
  /** Ignore first click on Recurring/Tags rows after dialog opens so FAB/menu taps are not retargeted into the dialog. */
  const ignoreNextDisclosureClickRef = useRef(false)
  const appliedPrefillKeyRef = useRef<string | null>(null)
  const prefillPayeeRawRef = useRef<string | null>(null)
  const skipCanonicalForPrefillRef = useRef(false)

  useEffect(() => {
    if (!transactionDialogOpen) {
      setDuplicateExisting(null)
    }
  }, [transactionDialogOpen])

  useEffect(() => {
    setDuplicateExisting(null)
  }, [date, payee, amount, type])

  useEffect(() => {
    if (!transactionDialogOpen) return
    ignoreNextDisclosureClickRef.current = true
    const t = setTimeout(() => {
      ignoreNextDisclosureClickRef.current = false
    }, 350)
    return () => clearTimeout(t)
  }, [transactionDialogOpen])

  useEffect(() => {
    if (!transactionDialogOpen) return
    fetch("/api/payee-aliases")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { sourceNormalized: string; canonicalPayee: string }[]) => {
        setPayeeAliasRules(
          rows.map((row) => ({
            sourceNormalized: row.sourceNormalized,
            canonicalPayee: row.canonicalPayee,
          })),
        )
      })
      .catch(() => setPayeeAliasRules([]))
  }, [transactionDialogOpen])

  const [showSuggestions, setShowSuggestions] = useState(false)
  const suggestionsRef = useRef<HTMLDivElement>(null)
  const payeeInputRef = useRef<HTMLInputElement>(null)

  const payeeIndex = useMemo(() => {
    const index = new Map<string, Map<string, number>>()
    for (const txn of state.transactions) {
      const key = txn.payee.toLowerCase()
      if (!index.has(key)) index.set(key, new Map())
      const envCounts = index.get(key)!
      envCounts.set(txn.envelopeId, (envCounts.get(txn.envelopeId) ?? 0) + 1)
    }
    return index
  }, [state.transactions])

  const payeeDisplayNameByLowerKey = useMemo(() => {
    const index = new Map<string, string>()
    for (const txn of state.transactions) {
      const key = txn.payee.toLowerCase()
      if (!index.has(key)) index.set(key, txn.payee)
    }
    return index
  }, [state.transactions])

  const payeeCanonicalCandidates = useMemo((): PayeeCandidate[] => {
    const rows: PayeeCandidate[] = []
    for (const [key, envCounts] of payeeIndex) {
      let total = 0
      for (const c of envCounts.values()) total += c
      const displayName = payeeDisplayNameByLowerKey.get(key) ?? key
      rows.push({ displayName, count: total })
    }
    for (const s of shortcuts) {
      rows.push({ displayName: s.payee, count: Math.max(1, s.usageCount) })
    }
    return mergePayeeCandidates(rows)
  }, [payeeIndex, payeeDisplayNameByLowerKey, shortcuts])

  useEffect(() => {
    if (!transactionDialogOpen) {
      appliedPrefillKeyRef.current = null
      return
    }
    if (!transactionPrefill) {
      appliedPrefillKeyRef.current = null
      return
    }
    const key = JSON.stringify(transactionPrefill)
    if (appliedPrefillKeyRef.current === key) return
    appliedPrefillKeyRef.current = key

    if (transactionPrefill.amount) setAmount(transactionPrefill.amount)
    if (transactionPrefill.date) setDate(transactionPrefill.date)
    if (transactionPrefill.notes) setNotes(transactionPrefill.notes)
    if (transactionPrefill.envelopeId) setEnvelopeId(transactionPrefill.envelopeId)
    if (transactionPrefill.type) setType(transactionPrefill.type)
    if (transactionPrefill.tags) setSelectedTags(transactionPrefill.tags)
  }, [transactionDialogOpen, transactionPrefill])

  useEffect(() => {
    if (!transactionDialogOpen) {
      prefillPayeeRawRef.current = null
      skipCanonicalForPrefillRef.current = false
      setPayeeMatchHint(null)
      setImportSourcePayee(null)
      setAliasSaveMessage(null)
      return
    }
    const raw = transactionPrefill?.payee?.trim()
    if (!raw) {
      prefillPayeeRawRef.current = null
      skipCanonicalForPrefillRef.current = false
      setPayee("")
      setPayeeMatchHint(null)
      setImportSourcePayee(null)
      setAliasSaveMessage(null)
      return
    }

    const applyResolved = (
      resolved: string,
      hint: { original: string; canonical: string; reason: CanonicalMatchReason } | null,
    ) => {
      setPayee(resolved)
      setPayeeMatchHint(hint)
      if (!transactionPrefill?.envelopeId) {
        const envId = bestEnvelopeIdForPayee(resolved, payeeIndex, activeEnvelopes)
        if (envId) setEnvelopeId(envId)
      }
    }

    if (prefillPayeeRawRef.current !== raw) {
      prefillPayeeRawRef.current = raw
      skipCanonicalForPrefillRef.current = false
      setImportSourcePayee(raw)
      setAliasSaveMessage(null)
      const r = resolveCanonicalPayee(raw, payeeCanonicalCandidates, payeeAliasRules)
      if (r) {
        applyResolved(r.canonicalPayee, {
          original: r.originalExtracted,
          canonical: r.canonicalPayee,
          reason: r.reason,
        })
      } else {
        applyResolved(raw, null)
      }
      return
    }

    if (!skipCanonicalForPrefillRef.current && prefillPayeeRawRef.current === raw) {
      const r = resolveCanonicalPayee(raw, payeeCanonicalCandidates, payeeAliasRules)
      if (!r) return

      const stillMatchesSoftEqualResolution =
        payeeMatchHint?.reason === "soft-equal" &&
        payee === payeeMatchHint.canonical

      if (payee === raw || stillMatchesSoftEqualResolution) {
        const resolutionUnchanged =
          payee === r.canonicalPayee &&
          payeeMatchHint?.reason === r.reason &&
          payeeMatchHint?.original === r.originalExtracted &&
          payeeMatchHint?.canonical === r.canonicalPayee
        if (resolutionUnchanged) return

        applyResolved(r.canonicalPayee, {
          original: r.originalExtracted,
          canonical: r.canonicalPayee,
          reason: r.reason,
        })
      }
    }
  }, [
    transactionDialogOpen,
    transactionPrefill,
    payeeCanonicalCandidates,
    payeeAliasRules,
    payee,
    payeeMatchHint,
    payeeIndex,
    activeEnvelopes,
  ])

  const payeeAliasAlreadyMatches = useMemo(() => {
    if (!importSourcePayee || !payee.trim()) return false
    const sn = normalizePayeeKey(importSourcePayee)
    const cn = normalizePayeeKey(payee)
    if (sn === cn) return true
    const rule = payeeAliasRules.find((a) => a.sourceNormalized === sn)
    return !!rule && normalizePayeeKey(rule.canonicalPayee) === cn
  }, [importSourcePayee, payee, payeeAliasRules])

  const showSavePayeeMapping =
    !!importSourcePayee &&
    payee.trim().length >= 2 &&
    normalizePayeeKey(importSourcePayee) !== normalizePayeeKey(payee) &&
    !payeeAliasAlreadyMatches

  const duplicateEnvelopeName = useMemo(() => {
    if (!duplicateExisting) return null
    return (
      activeEnvelopes.find((e) => e.id === duplicateExisting.envelopeId)?.name ??
      state.envelopes.find((e) => e.id === duplicateExisting.envelopeId)?.name ??
      null
    )
  }, [duplicateExisting, activeEnvelopes, state.envelopes])

  async function savePayeeMapping() {
    if (!importSourcePayee || !payee.trim()) return
    setAliasSaveBusy(true)
    setAliasSaveMessage(null)
    try {
      const res = await fetch("/api/payee-aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceLabel: importSourcePayee,
          canonicalPayee: payee.trim(),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setAliasSaveMessage(typeof err.error === "string" ? err.error : "Could not save mapping")
        return
      }
      const row = (await res.json()) as { sourceNormalized: string; canonicalPayee: string }
      setPayeeAliasRules((prev) => {
        const next = prev.filter((a) => a.sourceNormalized !== row.sourceNormalized)
        next.push({
          sourceNormalized: row.sourceNormalized,
          canonicalPayee: row.canonicalPayee,
        })
        return next
      })
      setAliasSaveMessage("Saved for future imports.")
    } finally {
      setAliasSaveBusy(false)
    }
  }

  const payeeSuggestions = useMemo(() => {
    const q = payee.trim().toLowerCase()
    if (q.length === 0) return []
    const matches: { name: string; envelopeId: string; count: number }[] = []
    for (const [key, envCounts] of payeeIndex) {
      if (!key.includes(q)) continue
      let bestEnv = ""
      let bestCount = 0
      let total = 0
      for (const [envId, count] of envCounts) {
        total += count
        if (count > bestCount) { bestCount = count; bestEnv = envId }
      }
      const originalName = state.transactions.find(t => t.payee.toLowerCase() === key)?.payee ?? key
      matches.push({ name: originalName, envelopeId: bestEnv, count: total })
    }
    return matches.sort((a, b) => b.count - a.count).slice(0, 8)
  }, [payee, payeeIndex, state.transactions])

  const selectPayeeSuggestion = useCallback((name: string, suggestedEnvelopeId: string) => {
    setPayee(name)
    setPayeeMatchHint(null)
    if (suggestedEnvelopeId && activeEnvelopes.some(e => e.id === suggestedEnvelopeId)) {
      setEnvelopeId(suggestedEnvelopeId)
    }
    setShowSuggestions(false)
  }, [activeEnvelopes])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) &&
          payeeInputRef.current && !payeeInputRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  function resetForm() {
    setType("expense")
    setPayee("")
    setAmount("")
    setEnvelopeId("")
    setDate(new Date().toISOString().split("T")[0])
    setSelectedTags([])
    setNewTag("")
    setNotes("")
    setIsRecurring(false)
    setCadence("monthly")
    setEndDate("")
    setSaveAsShortcut(false)
    setModalView("main")
    setValidationErrors({})
    setPayeeMatchHint(null)
    setImportSourcePayee(null)
    setAliasSaveMessage(null)
    setDuplicateExisting(null)
  }

  async function submitTransaction(options: { bypassDuplicateCheck?: boolean } = {}) {
    if (submitting) return
    if (modalView !== "main") return

    const errors: Record<string, string> = {}
    if (!payee.trim()) errors.payee = "Please enter a payee"

    const parsedAmount = Number.parseFloat(amount)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      errors.amount = "Please enter an amount"
    }

    if (!envelopeId) errors.envelope = "Please select an envelope"
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors)
      return
    }
    setValidationErrors({})

    const amt = Math.abs(parsedAmount)
    const dupCandidate = { date, payee: payee.trim(), amount: amt, type }

    const recurringId = transactionPrefill?.recurringId
    const shouldCheckDuplicate = Boolean(recurringId) || !isRecurring
    const bypassDup = options.bypassDuplicateCheck === true
    if (!bypassDup && shouldCheckDuplicate) {
      const hit = findCollidingTransaction(activeTransactions, dupCandidate)
      if (hit) {
        setDuplicateExisting(hit)
        return
      }
    }

    setDuplicateExisting(null)

    if (recurringId) {
      setSubmitting(true)
      try {
        const encPayee = await encryptForStorage(payee.trim())
        const encNotes = notes.trim() ? await encryptForStorage(notes.trim()) : null
        const res = await fetch("/api/recurring/post-now", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recurringId,
            payee: encPayee,
            amount: amt,
            type,
            envelopeId,
            tags: selectedTags,
            notes: encNotes,
            date,
          }),
        })
        if (!res.ok) {
          alert("Failed to post recurring transaction. Please try again.")
          return
        }
        await refreshData()
      } finally {
        setSubmitting(false)
      }
    } else if (isRecurring) {
      setSubmitting(true)
      try {
        const encPayee = await encryptForStorage(payee.trim())
        const encNotes = notes.trim() ? await encryptForStorage(notes.trim()) : null
        const res = await fetch("/api/recurring", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payee: encPayee,
            amount: amt,
            type,
            envelopeId,
            cadence,
            startDate: date,
            endDate: endDate || null,
            tags: selectedTags,
            notes: encNotes,
          }),
        })
        if (!res.ok) {
          alert("Failed to create recurring transaction. Please try again.")
          return
        }
        await refreshData()
      } finally {
        setSubmitting(false)
      }
    } else {
      addTransaction({
        date,
        payee: payee.trim(),
        amount: amt,
        type,
        envelopeId,
        tags: selectedTags,
        notes: notes.trim() || null,
      })
    }

    if (saveAsShortcut) {
      fetch("/api/shortcuts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payee: payee.trim(),
          defaultAmount: Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : null,
          envelopeId,
        }),
      })
    }

    resetForm()
    setTransactionDialogOpen(false)
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault()
    void submitTransaction()
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  function handleAddNewTag() {
    const trimmed = newTag.trim()
    if (trimmed && !state.tags.some((tag) => tag.name === trimmed)) {
      addTag(trimmed)
    }
    if (trimmed) {
      setSelectedTags((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]))
    }
    setNewTag("")
  }

  return (
    <Dialog open={transactionDialogOpen} onOpenChange={setTransactionDialogOpen}>
      <DialogContent className="flex max-h-[min(90dvh,900px)] min-h-0 flex-col gap-0 overflow-hidden border-[#1F1F1F] bg-[#0D0D0D] p-0 text-foreground sm:max-w-lg">
        <DialogHeader className="shrink-0 px-6 pb-2 pr-14 pt-6">
          <DialogTitle className="text-lg font-bold text-foreground">
            {transactionPrefill?.recurringId ? "Post Recurring Transaction" : "New Transaction"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleFormSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {modalView === "main" && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-4">
              <ShortcutsPanel shortcuts={shortcuts} />
              {/* Type toggle */}
              <div className="flex flex-col gap-2">
                <Label className="text-muted-foreground text-xs uppercase tracking-wider">Type</Label>
                <div className="flex rounded-lg bg-[#1A1A1A] p-1">
                  <button
                    type="button"
                    onClick={() => setType("expense")}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                      type === "expense"
                        ? "bg-[#F7931A] text-[#0D0D0D]"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Expense
                  </button>
                  <button
                    type="button"
                    onClick={() => setType("credit")}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                      type === "credit"
                        ? "bg-[#22C55E] text-[#0D0D0D]"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Credit
                  </button>
                </div>
              </div>

              {/* Payee */}
              <div className="flex flex-col gap-2 relative">
                <Label htmlFor="payee" className="text-muted-foreground text-xs uppercase tracking-wider">
                  {type === "expense" ? "Payee" : "Payer"}
                </Label>
                <Input
                  ref={payeeInputRef}
                  id="payee"
                  value={payee}
                  onChange={(e) => {
                    setPayee(e.target.value)
                    setPayeeMatchHint(null)
                    setAliasSaveMessage(null)
                    if (validationErrors.payee) setValidationErrors(prev => { const next = { ...prev }; delete next.payee; return next })
                    setShowSuggestions(true)
                  }}
                  onFocus={() => { if (payee.trim()) setShowSuggestions(true) }}
                  placeholder={type === "expense" ? "Who did you pay?" : "Who paid you?"}
                  className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555]"
                  autoComplete="off"
                  required
                />
                {showSuggestions && payeeSuggestions.length > 0 && (
                  <div
                    ref={suggestionsRef}
                    className="absolute top-full left-0 right-0 z-50 mt-1 bg-[#1A1A1A] border border-[#333] rounded-lg shadow-xl overflow-hidden max-h-52 overflow-y-auto"
                  >
                    {payeeSuggestions.map((s) => {
                      const env = state.envelopes.find(e => e.id === s.envelopeId)
                      return (
                        <button
                          key={s.name}
                          type="button"
                          onClick={() => selectPayeeSuggestion(s.name, s.envelopeId)}
                          className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[#252525] transition-colors"
                        >
                          <span className="text-sm text-foreground truncate">{s.name}</span>
                          {env && (
                            <span className="flex items-center gap-1.5 shrink-0 text-xs text-muted-foreground">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: env.color }} />
                              {env.name}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
                {validationErrors.payee && (
                  <p className="text-xs text-red-400 mt-1">{validationErrors.payee}</p>
                )}
                {payeeMatchHint && (
                  <p className="text-xs text-muted-foreground">
                    {payeeMatchHint.reason === "alias" && (
                      <>
                        Using your saved payee{" "}
                        <span className="font-medium text-foreground">{payeeMatchHint.canonical}</span>{" "}
                        for <span className="font-medium text-foreground">{payeeMatchHint.original}</span>.
                      </>
                    )}
                    {payeeMatchHint.reason === "soft-equal" && (
                      <>
                        <span className="font-medium text-foreground">{payeeMatchHint.original}</span> was
                        treated as the same merchant as{" "}
                        <span className="font-medium text-foreground">{payeeMatchHint.canonical}</span>{" "}
                        (hyphens / spacing only). Add a mapping in Settings if this is wrong.
                      </>
                    )}{" "}
                    <button
                      type="button"
                      className="text-btc-orange underline decoration-btc-orange/50 hover:decoration-btc-orange"
                      onClick={() => {
                        setPayee(payeeMatchHint.original)
                        setPayeeMatchHint(null)
                        skipCanonicalForPrefillRef.current = true
                      }}
                    >
                      Use original text
                    </button>
                  </p>
                )}
                {showSavePayeeMapping && (
                  <div className="flex flex-col gap-1.5 rounded-lg border border-[#333] bg-[#1A1A1A] px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                      Import showed{" "}
                      <span className="font-medium text-foreground">{importSourcePayee}</span> — always use{" "}
                      <span className="font-medium text-foreground">{payee.trim()}</span> for that text next
                      time?
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={aliasSaveBusy}
                        onClick={() => void savePayeeMapping()}
                        className="rounded-md bg-[#333] px-3 py-1.5 text-xs font-medium text-foreground hover:bg-[#444] disabled:opacity-50"
                      >
                        {aliasSaveBusy ? "Saving…" : "Save payee mapping"}
                      </button>
                      {aliasSaveMessage && (
                        <span className="text-xs text-muted-foreground">{aliasSaveMessage}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Amount */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="amount" className="text-muted-foreground text-xs uppercase tracking-wider">Amount (USD)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    id="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value)
                      if (validationErrors.amount) setValidationErrors(prev => { const next = { ...prev }; delete next.amount; return next })
                    }}
                    placeholder="0.00"
                    className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555] pl-7"
                    required
                  />
                </div>
                {validationErrors.amount && (
                  <p className="text-xs text-red-400 mt-1">{validationErrors.amount}</p>
                )}
              </div>

              {/* Envelope */}
              <div className="flex flex-col gap-2">
                <Label className="text-muted-foreground text-xs uppercase tracking-wider">Envelope</Label>
                <Select
                  value={envelopeId}
                  onValueChange={(v) => {
                    setEnvelopeId(v)
                    if (validationErrors.envelope) setValidationErrors(prev => { const next = { ...prev }; delete next.envelope; return next })
                  }}
                  required
                >
                  <SelectTrigger className="bg-[#1A1A1A] border-[#333] text-foreground">
                    <SelectValue placeholder="Select an envelope" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1A1A1A] border-[#333]">
                    {activeEnvelopes.map((env) => (
                      <SelectItem key={env.id} value={env.id} className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">
                        <span className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: env.color }} />
                          {env.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {validationErrors.envelope && (
                  <p className="text-xs text-red-400 mt-1">{validationErrors.envelope}</p>
                )}
              </div>

              {/* Date */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="date" className="text-muted-foreground text-xs uppercase tracking-wider">
                  {isRecurring ? "Start Date" : "Date"}
                </Label>
                <Input
                  id="date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="bg-[#1A1A1A] border-[#333] text-foreground"
                  required
                />
              </div>

              {/* Notes */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="notes" className="text-muted-foreground text-xs uppercase tracking-wider">
                  Notes <span className="text-[#555] normal-case">(optional)</span>
                </Label>
                <textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add any notes..."
                  rows={2}
                  className="w-full rounded-md bg-[#1A1A1A] border border-[#333] text-foreground placeholder:text-[#555] px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#F7931A]/50 focus:border-[#F7931A]/50"
                />
              </div>

              {/* Recurring disclosure row — hidden in post-now mode */}
              {!transactionPrefill?.recurringId && (
                <button
                  type="button"
                  onClick={() => {
                    if (ignoreNextDisclosureClickRef.current) return
                    recurringSnapshotRef.current = { isRecurring, cadence, endDate }
                    setModalView("recurring")
                  }}
                  className="flex items-center justify-between p-3 bg-[#1A1A1A] rounded-lg hover:bg-[#222] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Repeat className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-foreground">Recurring</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">
                      {isRecurring
                        ? `${CADENCE_OPTIONS.find(o => o.value === cadence)?.label ?? cadence}${endDate ? `, ends ${endDate}` : ""}`
                        : "Off"}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </button>
              )}

              {/* Tags disclosure row */}
              <button
                type="button"
                onClick={() => {
                  if (ignoreNextDisclosureClickRef.current) return
                  tagsSnapshotRef.current = [...selectedTags]
                  setModalView("tags")
                }}
                className="flex items-center justify-between p-3 bg-[#1A1A1A] rounded-lg hover:bg-[#222] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Tag className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-foreground">Tags</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    {selectedTags.length > 0 ? `${selectedTags.length} tag${selectedTags.length > 1 ? "s" : ""}` : "None"}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </button>

              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={saveAsShortcut}
                  onChange={(e) => setSaveAsShortcut(e.target.checked)}
                  className="rounded border-[#333]"
                />
                Save as shortcut
              </label>
              </div>

              <div className="shrink-0 border-t border-[#1F1F1F] bg-[#0D0D0D] px-6 py-4 space-y-3">
                {duplicateExisting && (
                  <div
                    role="alert"
                    aria-live="polite"
                    className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-3 text-sm"
                  >
                    <p className="font-medium text-foreground">Possible duplicate transaction</p>
                    <p className="mt-1 text-muted-foreground">
                      You already logged this{" "}
                      {duplicateExisting.type === "expense" ? "expense" : "credit"} on{" "}
                      <span className="text-foreground">{duplicateExisting.date}</span>
                      {": "}
                      <span className="text-foreground">{duplicateExisting.payee}</span>,{" "}
                      <span className="font-ibm-plex-mono text-foreground">
                        {formatUsdPrecise(duplicateExisting.amount)}
                      </span>
                      {duplicateEnvelopeName ? (
                        <>
                          {" "}
                          (<span className="text-foreground">{duplicateEnvelopeName}</span>)
                        </>
                      ) : null}
                      .
                    </p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
                      <button
                        type="button"
                        className="rounded-lg border border-[#333] bg-[#1A1A1A] px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-[#222]"
                        onClick={() => setDuplicateExisting(null)}
                      >
                        Edit details
                      </button>
                      <button
                        type="button"
                        className="rounded-lg bg-btc-orange px-3 py-2 text-sm font-semibold text-[#0D0D0D] transition-colors hover:bg-btc-orange/90"
                        onClick={() => {
                          void submitTransaction({ bypassDuplicateCheck: true })
                        }}
                      >
                        Save anyway
                      </button>
                    </div>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-lg bg-[#F7931A] py-3 text-sm font-semibold text-[#0D0D0D] transition-colors hover:bg-[#F7931A]/90 disabled:opacity-50"
                >
                  {submitting
                    ? transactionPrefill?.recurringId
                      ? "Posting..."
                      : "Creating..."
                    : transactionPrefill?.recurringId
                      ? `Post ${type === "expense" ? "Expense" : "Credit"} Now`
                      : isRecurring
                        ? `Add Recurring ${type === "expense" ? "Expense" : "Credit"}`
                        : type === "expense"
                          ? "Add Expense"
                          : "Add Credit"}
                </button>
              </div>
            </div>
          )}

          {modalView === "recurring" && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-4">
              <h3 className="text-sm font-semibold text-foreground">Recurring Settings</h3>

              <div className="flex items-center justify-between p-3 bg-[#1A1A1A] rounded-lg">
                <div className="flex items-center gap-2">
                  <Repeat className="h-4 w-4 text-muted-foreground" />
                  <Label htmlFor="recurring-toggle" className="text-sm text-foreground cursor-pointer">
                    Enable Recurring
                  </Label>
                </div>
                <Switch
                  id="recurring-toggle"
                  checked={isRecurring}
                  onCheckedChange={setIsRecurring}
                  className="data-[state=checked]:bg-[#F7931A]"
                />
              </div>

              {isRecurring && (
                <>
                  <div className="flex flex-col gap-2">
                    <Label className="text-muted-foreground text-xs uppercase tracking-wider">Cadence</Label>
                    <Select value={cadence} onValueChange={(v) => setCadence(v as Cadence)}>
                      <SelectTrigger className="bg-[#1A1A1A] border-[#333] text-foreground">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-[#1A1A1A] border-[#333]">
                        {CADENCE_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value} className="text-foreground focus:bg-[#2A2A2A] focus:text-foreground">
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="end-date" className="text-muted-foreground text-xs uppercase tracking-wider">
                      End Date <span className="text-[#555] normal-case">(optional)</span>
                    </Label>
                    <Input
                      id="end-date"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="bg-[#1A1A1A] border-[#333] text-foreground"
                    />
                  </div>
                </>
              )}

            </div>
              <div className="flex shrink-0 gap-3 border-t border-[#1F1F1F] bg-[#0D0D0D] px-6 py-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsRecurring(recurringSnapshotRef.current.isRecurring)
                    setCadence(recurringSnapshotRef.current.cadence)
                    setEndDate(recurringSnapshotRef.current.endDate)
                    setModalView("main")
                  }}
                  className="flex-1 rounded-lg border border-[#333] bg-[#1A1A1A] py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-[#222]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => setModalView("main")}
                  className="flex-1 rounded-lg bg-[#F7931A] py-2.5 text-sm font-semibold text-[#0D0D0D] transition-colors hover:bg-[#F7931A]/90"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {modalView === "tags" && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-4">
              <h3 className="text-sm font-semibold text-foreground">Tags</h3>

              <div className="flex flex-wrap gap-2">
                {state.tags.map((tag) => (
                  <Badge
                    key={tag.id}
                    variant={selectedTags.includes(tag.name) ? "default" : "outline"}
                    className={`cursor-pointer transition-colors ${
                      selectedTags.includes(tag.name)
                        ? "bg-[#F7931A] text-[#0D0D0D] hover:bg-[#F7931A]/80 border-transparent"
                        : "border-[#333] text-muted-foreground hover:border-[#F7931A]/50 hover:text-foreground"
                    }`}
                    onClick={() => toggleTag(tag.name)}
                  >
                    {tag.name}
                    {selectedTags.includes(tag.name) && <X className="ml-1 h-3 w-3" />}
                  </Badge>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <Input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handleAddNewTag()
                    }
                  }}
                  placeholder="Add new tag..."
                  className="bg-[#1A1A1A] border-[#333] text-foreground placeholder:text-[#555] h-8 text-xs"
                />
              </div>

            </div>
              <div className="flex shrink-0 gap-3 border-t border-[#1F1F1F] bg-[#0D0D0D] px-6 py-4">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTags(tagsSnapshotRef.current)
                    setNewTag("")
                    setModalView("main")
                  }}
                  className="flex-1 rounded-lg border border-[#333] bg-[#1A1A1A] py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-[#222]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { setNewTag(""); setModalView("main") }}
                  className="flex-1 rounded-lg bg-[#F7931A] py-2.5 text-sm font-semibold text-[#0D0D0D] transition-colors hover:bg-[#F7931A]/90"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  )
}
