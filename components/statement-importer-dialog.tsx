"use client"

import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import {
  FileText, Upload, ArrowRight, ArrowLeft, CheckCircle2, Loader2, AlertCircle, X,
  Tag, Repeat2, ChevronDown, ChevronUp, Sparkles, RotateCcw,
  Files, SplitSquareHorizontal,
} from "lucide-react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { tryParseStatementCsv } from "@/lib/statement-csv"
import type { StatementParseResult } from "@/lib/statement-csv"
import type { ParsedTransaction } from "@/lib/csv"
import type { Transaction } from "@/lib/data"
import type { StatementImporterPrefill } from "@/lib/app-context"
import { useApp } from "@/lib/app-context"
import { decryptParsedTransactionsForPreview } from "@/lib/import-preview-decrypt"
import { resolveImportCrypto, resolveSecretKeyForImport } from "@/lib/resolve-import-encrypt-fn"
import { makeDedupeKeyComputer } from "@/lib/import-dedupe-key"
import { findCollidingTransaction, findPayeeAgnosticMatches } from "@/lib/transaction-dedup"
import type { PayeeMatchCandidate } from "@/lib/transaction-dedup"
import { clearDraft, loadDraft, saveDraft } from "@/lib/draft-storage"
import type { PayeeAliasRule } from "@/lib/payee-canonical"
import { matchLongestAlias, normalizePayeeKey } from "@/lib/payee-canonical"
import { analyzeCreditRouting } from "@/lib/import-credit-routing"

// ─── Constants ────────────────────────────────────────────────────────────────

const SKIP_ROW = "__skip__"
export const STATEMENT_IMPORTER_DRAFT_KEY = "bitbudget-statement-importer-draft"
const DRAFT_VERSION = 2
const UNDO_WINDOW_SECS = 300

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = "upload" | "file_choice" | "preview" | "confirm" | "importing" | "done"
type ViewMode = "row" | "payee"
type CreditRoutingMode = "skip_income" | "review" | "import_all"
type CreditAction = "skip" | "savings" | "envelope" | "refund"

interface RowCreditAction {
  action: CreditAction
  envelopeId?: string
}

interface ParsedFile {
  fileName: string
  result: StatementParseResult
}

interface ExistingEnvelope {
  id: string
  name: string
  color: string
  systemRole?: string | null
}

interface PayeeMatchSuggestion {
  suggestedAlias: string
  confidence: "high" | "medium"
  matchCount: number
}

interface ImportSummary {
  imported: number
  skipped: number
  totalExpenses: number
  totalCreditsImported: number
  importBatchId: string | null
}

interface StatementImporterDraft {
  version: 2
  step: Extract<Step, "upload" | "preview">
  parsed: ParsedTransaction[] | null
  fileName: string | null
  institutionName: string | null
  rowEnvelopes: Record<number, string>
  manuallySetRows: number[]
  forceImportRows: number[]
  localAliases: Record<string, string>
  pendingAliasDeletes: string[]
  alwaysMapEnvelopes: boolean
  creditRoutingMode: CreditRoutingMode
  rowCreditActions: Record<number, RowCreditAction>
  viewMode: ViewMode
}

// ─── Validators ───────────────────────────────────────────────────────────────

function isParsedTransaction(v: unknown): v is ParsedTransaction {
  if (typeof v !== "object" || v == null) return false
  const t = v as ParsedTransaction
  return (
    typeof t.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.date) &&
    typeof t.payee === "string" &&
    typeof t.amount === "number" && Number.isFinite(t.amount) && t.amount >= 0 &&
    (t.type === "expense" || t.type === "credit") &&
    typeof t.envelopeName === "string" &&
    (t.notes === null || typeof t.notes === "string")
  )
}

function isStatementImporterDraft(v: unknown): v is StatementImporterDraft {
  if (typeof v !== "object" || v == null) return false
  const d = v as StatementImporterDraft
  return (
    d.version === DRAFT_VERSION &&
    (d.step === "upload" || d.step === "preview") &&
    (d.parsed === null || (Array.isArray(d.parsed) && d.parsed.every(isParsedTransaction))) &&
    (d.fileName === null || typeof d.fileName === "string") &&
    typeof d.rowEnvelopes === "object" &&
    Array.isArray(d.manuallySetRows) &&
    Array.isArray(d.forceImportRows) &&
    typeof d.localAliases === "object" &&
    Array.isArray(d.pendingAliasDeletes) &&
    typeof d.alwaysMapEnvelopes === "boolean"
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-")
  if (!y || !m || !d) return iso
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
  return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`
}

function resolveDisplayPayee(
  rawPayee: string,
  localAliases: Record<string, string>,
  loadedAliases: PayeeAliasRule[],
): string | null {
  if (localAliases[rawPayee]) return localAliases[rawPayee]!
  const alias = matchLongestAlias(rawPayee, loadedAliases)
  return alias ? alias.canonicalPayee : null
}

function resolveCanonicalPayee(
  rawPayee: string,
  localAliases: Record<string, string>,
  loadedAliases: PayeeAliasRule[],
): string {
  return resolveDisplayPayee(rawPayee, localAliases, loadedAliases) ?? rawPayee
}

/**
 * Suggest a normalized/cleaned payee name (strip store #, location suffix).
 * Returns null if the suggestion wouldn't differ meaningfully.
 */
function suggestNormalizedPayee(raw: string): string | null {
  const cleaned = raw.trim()
    .replace(/\s*#\s*\d+/g, "")
    .replace(/\s+[A-Z]{2}\s*$/i, "")
    .replace(/\s+US\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim()
  if (cleaned.length > 0 && cleaned.toLowerCase() !== raw.trim().toLowerCase()) {
    return cleaned
  }
  return null
}

function getAutoImportMoratoriumKey(institutionName: string): string {
  let hash = 0
  for (let i = 0; i < institutionName.length; i++) {
    hash = (Math.imul(31, hash) + institutionName.charCodeAt(i)) | 0
  }
  return String(Math.abs(hash))
}

function shouldShowAutoImportCta(institutionName: string | null): boolean {
  if (!institutionName) return false
  try {
    const stored = localStorage.getItem("bitbudget-autoimport-shown")
    if (!stored) return true
    const map = JSON.parse(stored) as Record<string, number>
    const key = getAutoImportMoratoriumKey(institutionName)
    const last = map[key]
    if (!last) return true
    return Date.now() - last > 7 * 24 * 60 * 60 * 1000
  } catch {
    return true
  }
}

function recordAutoImportCta(institutionName: string) {
  try {
    const stored = localStorage.getItem("bitbudget-autoimport-shown")
    const map = stored ? (JSON.parse(stored) as Record<string, number>) : {}
    map[getAutoImportMoratoriumKey(institutionName)] = Date.now()
    localStorage.setItem("bitbudget-autoimport-shown", JSON.stringify(map))
  } catch {}
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StatementImporterDialog({
  open,
  onOpenChange,
  existingTransactions,
  onImportComplete,
  initialData,
  pendingBatchId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingTransactions: Transaction[]
  onImportComplete?: () => void
  initialData?: StatementImporterPrefill | null
  pendingBatchId?: string | null
}) {
  const { state, navigateTo, hasPremiumFeatures } = useApp()
  const monthlyIncome = state.monthlyIncome ?? 0

  // ── Core step/file state ──
  const [step, setStep] = useState<Step>(() => {
    if (initialData || pendingBatchId) return "preview"
    return "upload"
  })
  const [files, setFiles] = useState<ParsedFile[]>([])
  const [fileMode, setFileMode] = useState<"merge" | "individual">("individual")
  const [currentFileIndex, setCurrentFileIndex] = useState(0) // used in individual file queue mode
  const [parsed, setParsed] = useState<ParsedTransaction[] | null>(
    () => initialData?.transactions ?? null,
  )
  const [fileName, setFileName] = useState<string | null>(null)
  const [institutionName, setInstitutionName] = useState<string | null>(
    () => initialData?.meta?.institutionName ?? null,
  )
  const [statementFormat, setStatementFormat] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // ── Envelope / suggestion state ──
  const [envelopes, setEnvelopes] = useState<ExistingEnvelope[]>([])
  const [rowEnvelopes, setRowEnvelopes] = useState<Record<number, string>>({})
  const [manuallySetRows, setManuallySetRows] = useState<Set<number>>(new Set())
  const [envelopeSuggestions, setEnvelopeSuggestions] = useState<Record<string, string>>({})

  // ── Dupe / force-import ──
  const [forceImportRows, setForceImportRows] = useState<Set<number>>(new Set())
  const [dupeFilterActive, setDupeFilterActive] = useState(false)

  // ── Payee mapping ──
  const [expandedMappingRow, setExpandedMappingRow] = useState<number | null>(null)
  const [localAliases, setLocalAliases] = useState<Record<string, string>>({})
  const [pendingAliasDeletes, setPendingAliasDeletes] = useState<string[]>([])
  const [loadedAliases, setLoadedAliases] = useState<PayeeAliasRule[]>([])
  const [aliasInputs, setAliasInputs] = useState<Record<string, string>>({})
  const [payeeMatchSuggestions, setPayeeMatchSuggestions] = useState<Record<number, PayeeMatchSuggestion>>({})
  const [skippedMatchSuggestions, setSkippedMatchSuggestions] = useState<Set<string>>(new Set())

  // ── Always-map / view ──
  const [alwaysMapEnvelopes, setAlwaysMapEnvelopes] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>("row")

  // ── Credit routing ──
  const [creditRoutingMode, setCreditRoutingMode] = useState<CreditRoutingMode>("skip_income")
  const [rowCreditActions, setRowCreditActions] = useState<Record<number, RowCreditAction>>({})

  // ── Recurring ──
  const [expandedRecurringRow, setExpandedRecurringRow] = useState<number | null>(null)
  const [recurringCadences, setRecurringCadences] = useState<Record<number, string>>({})
  const [recurringEndDates, setRecurringEndDates] = useState<Record<number, string>>({})

  // ── Done state ──
  const [result, setResult] = useState<ImportSummary | null>(null)
  const [undoTimeLeft, setUndoTimeLeft] = useState(0)
  const [showAutoImportCta, setShowAutoImportCta] = useState(false)

  // ── UI misc ──
  const [clearOpen, setClearOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const openHydratedRef = useRef(false)
  const childModalOpenRef = useRef(false)

  // ─── Derived: unique payee suggestions for autocomplete ─────────────────────
  const payeeSuggestions = useMemo(() => {
    const set = new Set<string>()
    for (const t of existingTransactions) {
      if (t.payee && t.payee !== "•••") set.add(t.payee)
    }
    for (const a of loadedAliases) {
      if (a.canonicalPayee) set.add(a.canonicalPayee)
    }
    return Array.from(set).sort()
  }, [existingTransactions, loadedAliases])

  // ─── Derived: savings envelope id ────────────────────────────────────────────
  const savingsEnvelopeId = useMemo(
    () => envelopes.find((e) => e.systemRole === "savings")?.id,
    [envelopes],
  )

  // ─── Derived: dupe/match analysis ────────────────────────────────────────────
  const { duplicateRows, matchSuggestions } = useMemo(() => {
    if (!parsed) return { duplicateRows: new Set<number>(), matchSuggestions: {} as Record<number, PayeeMatchSuggestion> }
    const dupes = new Set<number>()
    const suggestions: Record<number, PayeeMatchSuggestion> = {}
    // De-duplicate suggestions by raw payee
    const payeeSuggestionCache = new Map<string, PayeeMatchSuggestion | null>()

    for (let i = 0; i < parsed.length; i++) {
      const t = parsed[i]!
      if (findCollidingTransaction(existingTransactions, t)) {
        dupes.add(i)
        continue
      }
      const rawPayee = t.payee
      if (!payeeSuggestionCache.has(rawPayee)) {
        const matches: PayeeMatchCandidate[] = findPayeeAgnosticMatches(existingTransactions, t)
        if (matches.length === 0) {
          payeeSuggestionCache.set(rawPayee, null)
        } else {
          const best = matches[0]!
          payeeSuggestionCache.set(rawPayee, {
            suggestedAlias: best.transaction.payee,
            confidence: best.confidence,
            matchCount: matches.length,
          })
        }
      }
      const cached = payeeSuggestionCache.get(rawPayee)
      if (cached) suggestions[i] = cached
    }
    return { duplicateRows: dupes, matchSuggestions: suggestions }
  }, [parsed, existingTransactions])

  const duplicateCount = duplicateRows.size

  // ─── Derived: credit analysis ────────────────────────────────────────────────
  const creditAnalyses = useMemo(() => {
    if (!parsed) return {}
    const analyses: Record<number, ReturnType<typeof analyzeCreditRouting>> = {}
    for (let i = 0; i < parsed.length; i++) {
      const t = parsed[i]!
      if (t.type === "credit") {
        analyses[i] = analyzeCreditRouting(t, parsed, existingTransactions, monthlyIncome, savingsEnvelopeId)
      }
    }
    return analyses
  }, [parsed, existingTransactions, monthlyIncome, savingsEnvelopeId])

  // ─── Resolve effective credit action for a row ───────────────────────────────
  function effectiveCreditAction(i: number): RowCreditAction {
    if (rowCreditActions[i]) return rowCreditActions[i]!
    const analysis = creditAnalyses[i]
    if (!analysis) return { action: "envelope" }

    if (creditRoutingMode === "import_all") return { action: "envelope" }
    if (creditRoutingMode === "skip_income" && analysis.origin === "income") return { action: "skip" }

    // Refund: route to matched envelope
    if (analysis.origin === "refund" && analysis.refundEnvelopeId) {
      return { action: "refund", envelopeId: analysis.refundEnvelopeId }
    }
    // Small reward → Savings
    if (analysis.origin === "reward" && savingsEnvelopeId) {
      return { action: "savings", envelopeId: savingsEnvelopeId }
    }
    return { action: "envelope" }
  }

  // ─── Derived: rows to import ─────────────────────────────────────────────────
  const rowsToImport = useMemo(() => {
    if (!parsed) return []
    return parsed
      .map((txn, i) => ({ txn, i }))
      .filter(({ txn, i }) => {
        if (rowEnvelopes[i] === SKIP_ROW) return false
        if (txn.type === "credit") {
          const action = effectiveCreditAction(i)
          if (action.action === "skip") return false
        }
        if (duplicateRows.has(i) && !forceImportRows.has(i)) return false
        return true
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, rowEnvelopes, duplicateRows, forceImportRows, rowCreditActions, creditRoutingMode, creditAnalyses])

  const toImportCount = rowsToImport.length

  const totalDebits = parsed
    ? parsed.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0)
    : 0
  const totalCredits = parsed
    ? parsed.filter(t => t.type === "credit").reduce((s, t) => s + t.amount, 0)
    : 0

  const dateRange = useMemo(() => {
    if (!parsed || parsed.length === 0) return null
    const dates = parsed.map(t => t.date).sort()
    const first = dates[0]!
    const last = dates[dates.length - 1]!
    return first === last ? formatDate(first) : `${formatDate(first)} – ${formatDate(last)}`
  }, [parsed])

  // ─── Dialog title ────────────────────────────────────────────────────────────
  const dialogTitle = useMemo(() => {
    if (step === "done") return "Import Complete"
    if (files.length > 1 && fileMode === "individual" && step === "preview") {
      const prefix = institutionName ? `Import your ${institutionName} statement` : "Import Statement"
      return `${prefix} (${currentFileIndex + 1} of ${files.length})`
    }
    if (institutionName && (files.length <= 1 || fileMode !== "merge")) {
      return `Import your ${institutionName} statement`
    }
    return "Import Statement"
  }, [step, institutionName, files.length, fileMode, currentFileIndex])

  // ─── Unique payee list for payee view ────────────────────────────────────────
  const uniquePayees = useMemo(() => {
    if (!parsed) return []
    const map = new Map<string, number[]>()
    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i]!.payee
      const existing = map.get(p) ?? []
      existing.push(i)
      map.set(p, existing)
    }
    return Array.from(map.entries()).map(([payee, rows]) => ({ payee, rows }))
  }, [parsed])

  // ─── Reset ───────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setStep("upload")
    setFiles([])
    setFileMode("individual")
    setCurrentFileIndex(0)
    setParsed(null)
    setFileName(null)
    setInstitutionName(null)
    setStatementFormat(null)
    setEnvelopes([])
    setRowEnvelopes({})
    setManuallySetRows(new Set())
    setEnvelopeSuggestions({})
    setForceImportRows(new Set())
    setDupeFilterActive(false)
    setExpandedMappingRow(null)
    setLocalAliases({})
    setPendingAliasDeletes([])
    setLoadedAliases([])
    setAliasInputs({})
    setPayeeMatchSuggestions({})
    setSkippedMatchSuggestions(new Set())
    setAlwaysMapEnvelopes(false)
    setViewMode("row")
    setCreditRoutingMode("skip_income")
    setRowCreditActions({})
    setExpandedRecurringRow(null)
    setRecurringCadences({})
    setRecurringEndDates({})
    setResult(null)
    setUndoTimeLeft(0)
    setShowAutoImportCta(false)
    setIsDragging(false)
    setParseError(null)
    setImportError(null)
    setLoading(false)
    setClearOpen(false)
  }, [])

  const resetAndClearDraft = useCallback(() => {
    reset()
    clearDraft(STATEMENT_IMPORTER_DRAFT_KEY)
  }, [reset])

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen && childModalOpenRef.current) return
      if (!isOpen) reset()
      onOpenChange(isOpen)
    },
    [onOpenChange, reset],
  )

  // ─── Draft hydration ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) { openHydratedRef.current = false; return }
    if (openHydratedRef.current || initialData || pendingBatchId) return
    openHydratedRef.current = true

    const draft = loadDraft(STATEMENT_IMPORTER_DRAFT_KEY, isStatementImporterDraft)
    if (!draft) return

    setStep(draft.parsed && draft.parsed.length > 0 ? "preview" : "upload")
    setParsed(draft.parsed)
    setFileName(draft.fileName)
    setInstitutionName(draft.institutionName)
    setRowEnvelopes(draft.rowEnvelopes)
    setManuallySetRows(new Set(draft.manuallySetRows))
    setForceImportRows(new Set(draft.forceImportRows))
    setLocalAliases(draft.localAliases)
    setPendingAliasDeletes(draft.pendingAliasDeletes)
    setAlwaysMapEnvelopes(draft.alwaysMapEnvelopes)
    setCreditRoutingMode(draft.creditRoutingMode)
    setRowCreditActions(draft.rowCreditActions)
    setViewMode(draft.viewMode)
    setParseError(null)
    setImportError(null)
    setLoading(false)

    if (draft.parsed && draft.parsed.length > 0) {
      void loadEnvelopes()
      void loadAliases()
    }
  }, [open, initialData, pendingBatchId])

  // ─── Draft persistence ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || step === "importing" || step === "done" || step === "confirm" || step === "file_choice") return
    const hasSaveable = parsed !== null || fileName !== null
    if (!hasSaveable) { clearDraft(STATEMENT_IMPORTER_DRAFT_KEY); return }
    saveDraft(STATEMENT_IMPORTER_DRAFT_KEY, {
      version: DRAFT_VERSION,
      step: parsed && parsed.length > 0 ? "preview" : "upload",
      parsed,
      fileName,
      institutionName,
      rowEnvelopes,
      manuallySetRows: Array.from(manuallySetRows),
      forceImportRows: Array.from(forceImportRows),
      localAliases,
      pendingAliasDeletes,
      alwaysMapEnvelopes,
      creditRoutingMode,
      rowCreditActions,
      viewMode,
    } satisfies StatementImporterDraft)
  }, [open, step, parsed, fileName, institutionName, rowEnvelopes, manuallySetRows, forceImportRows, localAliases, pendingAliasDeletes, alwaysMapEnvelopes, creditRoutingMode, rowCreditActions, viewMode])

  // ─── Load initial data from initialData prop ─────────────────────────────────
  useEffect(() => {
    if (initialData) {
      void loadEnvelopes()
      void loadAliases()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Load pending batch (email forwarding mode) ───────────────────────────────
  useEffect(() => {
    if (!pendingBatchId || !open) return
    async function loadPendingBatch() {
      setLoading(true)
      try {
        const res = await fetch(`/api/import/pending-batch/${pendingBatchId}`)
        if (!res.ok) throw new Error("Failed to load pending statement")
        const data = await res.json() as {
          transactions: ParsedTransaction[]
          institutionName?: string | null
          format: string
          dateFrom?: string | null
          dateTo?: string | null
        }
        const secretKey = await resolveSecretKeyForImport()
        setParsed(decryptParsedTransactionsForPreview(data.transactions, secretKey))
        setInstitutionName(data.institutionName ?? null)
        setStatementFormat(data.format ?? null)
        setStep("preview")
        await loadEnvelopes()
        await loadAliases()
      } catch (err) {
        setParseError(err instanceof Error ? err.message : "Failed to load statement")
        setStep("upload")
      } finally {
        setLoading(false)
      }
    }
    void loadPendingBatch()
  }, [pendingBatchId, open])

  // ─── Undo countdown ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (undoTimeLeft <= 0) return
    const id = setInterval(() => {
      setUndoTimeLeft(t => Math.max(0, t - 1))
    }, 1000)
    return () => clearInterval(id)
  }, [undoTimeLeft])

  // ─── Apply envelope suggestions when they arrive or aliases change ───────────
  useEffect(() => {
    if (!parsed || Object.keys(envelopeSuggestions).length === 0) return
    setRowEnvelopes(prev => {
      const next = { ...prev }
      for (let i = 0; i < parsed.length; i++) {
        if (manuallySetRows.has(i)) continue
        const raw = parsed[i]!.payee
        const canonical = resolveCanonicalPayee(raw, localAliases, loadedAliases)
        const norm = normalizePayeeKey(canonical)
        const suggested = envelopeSuggestions[norm]
        if (suggested && !next[i]) {
          next[i] = suggested
        }
      }
      return next
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envelopeSuggestions, localAliases])

  // ─── Loaders ─────────────────────────────────────────────────────────────────
  async function loadEnvelopes() {
    try {
      const res = await fetch("/api/envelopes")
      if (res.ok) setEnvelopes(await res.json() as ExistingEnvelope[])
    } catch {}
  }

  async function loadAliases() {
    try {
      const res = await fetch("/api/payee-aliases")
      if (res.ok) setLoadedAliases(await res.json() as PayeeAliasRule[])
    } catch {}
  }

  async function loadEnvelopeSuggestions(payeesToCheck: string[]) {
    if (payeesToCheck.length === 0) return
    try {
      const res = await fetch("/api/suggest-envelopes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payees: payeesToCheck.slice(0, 500) }),
      })
      if (res.ok) {
        const data = await res.json() as { suggestions: Record<string, string> }
        setEnvelopeSuggestions(data.suggestions)
      }
    } catch {}
  }

  // ─── Transition to preview ────────────────────────────────────────────────────
  async function transitionToPreview(
    transactions: ParsedTransaction[],
    instName: string | null,
    format: string | null = null,
  ) {
    setParsed(transactions)
    setInstitutionName(instName)
    setStatementFormat(format)
    setStep("preview")

    // Default to payee view for large statements
    const unique = new Set(transactions.map(t => t.payee))
    if (unique.size > 10) setViewMode("payee")

    await Promise.all([loadEnvelopes(), loadAliases()])

    const uniquePayeeList = Array.from(unique)
    await loadEnvelopeSuggestions(uniquePayeeList)
  }

  // ─── File processing ──────────────────────────────────────────────────────────
  async function processFiles(fileList: File[]) {
    if (fileList.length === 0) return
    setParseError(null)
    setLoading(true)

    const parsed: ParsedFile[] = []

    for (const file of fileList) {
      const name = file.name.toLowerCase()
      const isCsv = name.endsWith(".csv")
      const isPdf = name.endsWith(".pdf")

      if (!isCsv && !isPdf) {
        setParseError("Please upload .csv or .pdf bank statement files.")
        setLoading(false)
        return
      }

      try {
        if (isCsv) {
          const text = await file.text()
          const result = tryParseStatementCsv(text)
          if (!result) throw new Error(
            "This CSV doesn't look like a supported bank statement. To import a BitBudget export, use Import CSV instead."
          )
          parsed.push({ fileName: file.name, result })
        } else {
          const fd = new FormData()
          fd.append("file", file)
          const res = await fetch("/api/receipts/scan", { method: "POST", body: fd })
          const data = await res.json() as {
            type?: string
            transactions?: ParsedTransaction[]
            meta?: { institutionName?: string }
            format?: string
            error?: string
          }
          if (!res.ok) throw new Error(data.error ?? "Failed to parse PDF")
          if (data.type !== "statement") throw new Error(
            "This PDF doesn't look like a supported bank statement."
          )
          const transactions = data.transactions ?? []
          parsed.push({
            fileName: file.name,
            result: {
              transactions,
              totalRows: transactions.length,
              skippedRows: 0,
              format: (data.format ?? "fold_pdf") as "fold_csv",
              institutionName: data.meta?.institutionName ?? "Fold",
            },
          })
        }
      } catch (err) {
        setParseError(err instanceof Error ? err.message : "Failed to read file.")
        setLoading(false)
        return
      }
    }

    setLoading(false)

    if (parsed.length === 0) {
      setParseError("No transactions found.")
      return
    }

    setFileName(parsed.map(f => f.fileName).join(", "))

    if (parsed.length === 1) {
      const first = parsed[0]!
      if (first.result.transactions.length === 0) {
        setParseError("No transactions found in this file.")
        return
      }
      await transitionToPreview(
        first.result.transactions,
        first.result.institutionName,
        first.result.format,
      )
      return
    }

    // Multiple files — show choice
    setFiles(parsed)
    // Default: individual if all same institution, merge if mixed
    const allSame = parsed.every(f => f.result.institutionName === parsed[0]!.result.institutionName)
    setFileMode(allSame ? "individual" : "merge")
    setStep("file_choice")
  }

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    void processFiles(Array.from(fileList))
  }

  async function applyFileChoice() {
    if (fileMode === "merge") {
      const merged: ParsedTransaction[] = files.flatMap(f => f.result.transactions)
      const instName = files.every(f => f.result.institutionName === files[0]!.result.institutionName)
        ? files[0]!.result.institutionName
        : null
      const format = files.every(f => f.result.format === files[0]!.result.format)
        ? files[0]!.result.format
        : null
      await transitionToPreview(merged, instName, format)
    } else {
      // Individual mode — start with first file
      setCurrentFileIndex(0)
      const first = files[0]!
      await transitionToPreview(
        first.result.transactions,
        first.result.institutionName,
        first.result.format,
      )
    }
  }

  // ─── Payee alias management ───────────────────────────────────────────────────
  function setAlias(rawPayee: string, canonical: string) {
    setLocalAliases(prev => ({ ...prev, [rawPayee]: canonical }))
    setAliasInputs(prev => ({ ...prev, [rawPayee]: canonical }))
    // Apply transitive envelope suggestion
    const norm = normalizePayeeKey(canonical)
    const suggestedEnv = envelopeSuggestions[norm]
    if (suggestedEnv && parsed) {
      setRowEnvelopes(prev => {
        const next = { ...prev }
        for (let i = 0; i < parsed.length; i++) {
          if (manuallySetRows.has(i)) continue
          if (parsed[i]!.payee === rawPayee) next[i] = suggestedEnv
        }
        return next
      })
    }
  }

  function removeAlias(rawPayee: string) {
    setLocalAliases(prev => {
      const next = { ...prev }
      delete next[rawPayee]
      return next
    })
    // If there's a loaded alias for this payee, queue a delete
    const loadedAlias = matchLongestAlias(rawPayee, loadedAliases)
    if (loadedAlias?.id) {
      setPendingAliasDeletes(prev => [...prev, loadedAlias.id!])
    }
  }

  // ─── Envelope assignment ─────────────────────────────────────────────────────
  function setRowEnvelope(index: number, envelopeId: string, manual = true) {
    if (!parsed) return
    const rawPayee = parsed[index]!.payee

    setRowEnvelopes(prev => {
      const next = { ...prev }
      next[index] = envelopeId
      // Propagate to all rows with the same raw payee that aren't manually set
      if (manual) {
        for (let i = 0; i < parsed.length; i++) {
          if (i === index) continue
          if (manuallySetRows.has(i)) continue
          if (parsed[i]!.payee === rawPayee) next[i] = envelopeId
        }
      }
      return next
    })

    if (manual) {
      setManuallySetRows(prev => new Set([...prev, index]))
    }
  }

  // ─── Import ───────────────────────────────────────────────────────────────────
  async function handleImport() {
    if (!parsed || parsed.length === 0) return
    setImportError(null)
    setStep("importing")

    try {
      const crypto = await resolveImportCrypto()
      if (!crypto) throw new Error(
        "Encryption key not available. Unlock the app and try again."
      )
      const { encrypt, seedHex } = crypto
      const dedupeComputer = makeDedupeKeyComputer(seedHex)

      let totalExpenses = 0
      let totalCreditsImported = 0

      const toImport = await Promise.all(
        parsed
          .map((t, i) => ({ t, i }))
          .filter(({ t: txn, i }) => {
            if (rowEnvelopes[i] === SKIP_ROW) return false
            if (txn.type === "credit") {
              const action = effectiveCreditAction(i)
              if (action.action === "skip") return false
            }
            if (duplicateRows.has(i) && !forceImportRows.has(i)) return false
            return true
          })
          .map(async ({ t, i }) => {
            const canonical = resolveCanonicalPayee(t.payee, localAliases, loadedAliases)
            const encPayee = await encrypt(canonical)
            const encNotes = t.notes ? await encrypt(t.notes) : null

            let envelopeId = rowEnvelopes[i]
            if (t.type === "credit") {
              const action = effectiveCreditAction(i)
              if (action.action === "savings" || action.action === "refund") {
                envelopeId = action.envelopeId ?? envelopeId
              }
            }

            if (t.type === "expense") totalExpenses += t.amount
            else totalCreditsImported += t.amount

            const envObj = envelopes.find(e => e.id === envelopeId)
            const dedupeKey = dedupeComputer({
              date: t.date,
              payee: canonical,
              amount: t.amount,
              type: t.type,
            })
            return {
              date: t.date,
              payee: encPayee,
              amount: t.amount,
              type: t.type,
              envelopeName: envObj?.name ?? "Uncategorized",
              notes: encNotes,
              dedupeKey,
              ...(envelopeId && envelopeId !== SKIP_ROW ? { envelopeId } : {}),
            }
          })
      )

      if (toImport.length === 0) {
        setResult({ imported: 0, skipped: parsed.length, totalExpenses: 0, totalCreditsImported: 0, importBatchId: null })
        clearDraft(STATEMENT_IMPORTER_DRAFT_KEY)
        setStep("done")
        return
      }

      // Encrypt institution name before sending to server
      const encInstitutionName = institutionName ? await encrypt(institutionName) : null

      const dates = parsed.map(t => t.date).sort()
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactions: toImport,
          envelopeMapping: {},
          source: "statement_import",
          institutionName: encInstitutionName,
          dateRange: dates.length > 0 ? { from: dates[0]!, to: dates[dates.length - 1]! } : undefined,
          statementFormat: statementFormat ?? "fold_csv",
        }),
      })

      let data: { imported?: number; skipped?: number; newEnvelopes?: string[]; importBatchId?: string; error?: string }
      try { data = await res.json() } catch { throw new Error("Import failed.") }
      if (!res.ok) throw new Error(data.error ?? "Import failed.")

      const batchId = data.importBatchId ?? null

      // Post-import: save mappings if checkbox is checked
      if (alwaysMapEnvelopes) {
        // Collect unique canonical payee → envelope pairs
        const mappingMap = new Map<string, string>()
        for (let i = 0; i < parsed.length; i++) {
          if (rowEnvelopes[i] === SKIP_ROW) continue
          if (duplicateRows.has(i) && !forceImportRows.has(i)) continue
          const envId = rowEnvelopes[i]
          if (!envId) continue
          const canonical = resolveCanonicalPayee(parsed[i]!.payee, localAliases, loadedAliases)
          // Most-frequent wins — just take last one per payee for simplicity
          mappingMap.set(canonical, envId)
        }
        if (mappingMap.size > 0) {
          await fetch("/api/payee-envelope-mappings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mappings: Array.from(mappingMap.entries()).map(([payee, envelopeId]) => ({ payee, envelopeId })),
            }),
          }).catch(() => {})
        }

        // Save new aliases
        for (const [source, canonical] of Object.entries(localAliases)) {
          const alreadyLoaded = loadedAliases.some(a => a.sourceNormalized === normalizePayeeKey(source) && a.canonicalPayee === canonical)
          if (!alreadyLoaded) {
            await fetch("/api/payee-aliases", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sourceLabel: source, canonicalPayee: canonical }),
            }).catch(() => {})
          }
        }
      }

      // Delete unlinked aliases
      for (const aliasId of pendingAliasDeletes) {
        await fetch(`/api/payee-aliases?id=${aliasId}`, { method: "DELETE" }).catch(() => {})
      }

      // Delete pending batch if in pendingBatchId mode
      if (pendingBatchId) {
        await fetch(`/api/import/pending-batch/${pendingBatchId}`, { method: "DELETE" }).catch(() => {})
      }

      setResult({
        imported: data.imported ?? 0,
        skipped: (data.skipped ?? 0) + (parsed.length - toImport.length),
        totalExpenses,
        totalCreditsImported,
        importBatchId: batchId,
      })

      if (batchId) {
        setUndoTimeLeft(UNDO_WINDOW_SECS)
        const showCta = shouldShowAutoImportCta(institutionName)
        if (showCta && institutionName) {
          setShowAutoImportCta(true)
          recordAutoImportCta(institutionName)
        }
      }

      clearDraft(STATEMENT_IMPORTER_DRAFT_KEY)
      setStep("done")
      if (onImportComplete) await onImportComplete()
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed.")
      setStep("preview")
    }
  }

  async function handleUndo() {
    if (!result?.importBatchId) return
    try {
      const res = await fetch(`/api/transactions/batch/${result.importBatchId}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Undo failed")
      setUndoTimeLeft(0)
      handleOpenChange(false)
      if (onImportComplete) await onImportComplete()
    } catch {
      // Show error inline if needed
    }
  }

  // ─── Draft change detection ───────────────────────────────────────────────────
  const hasDraftChanges =
    step === "preview" || step === "confirm" ||
    parsed !== null || fileName !== null

  // ─── Confirm step: group by envelope ─────────────────────────────────────────
  const confirmGroups = useMemo(() => {
    if (!parsed) return []
    const groups = new Map<string, { envelope: ExistingEnvelope | null; rows: { t: ParsedTransaction; i: number }[] }>()
    for (let i = 0; i < parsed.length; i++) {
      const { t } = { t: parsed[i]! }
      if (rowEnvelopes[i] === SKIP_ROW) continue
      if (t.type === "credit") {
        const action = effectiveCreditAction(i)
        if (action.action === "skip") continue
      }
      if (duplicateRows.has(i) && !forceImportRows.has(i)) continue

      const envId = (() => {
        if (t.type === "credit") {
          const action = effectiveCreditAction(i)
          if (action.action === "savings" || action.action === "refund") return action.envelopeId ?? rowEnvelopes[i]
        }
        return rowEnvelopes[i]
      })()
      const key = envId ?? "__unassigned__"
      if (!groups.has(key)) {
        groups.set(key, {
          envelope: envelopes.find(e => e.id === envId) ?? null,
          rows: [],
        })
      }
      groups.get(key)!.rows.push({ t, i })
    }
    return Array.from(groups.entries()).map(([, g]) => g)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, rowEnvelopes, duplicateRows, forceImportRows, envelopes, rowCreditActions, creditRoutingMode, creditAnalyses])

  // ─── Render helpers ───────────────────────────────────────────────────────────
  function renderEnvelopeSelect(index: number, compact = false) {
    const value = rowEnvelopes[index] ?? ""
    return (
      <Select
        value={value}
        onValueChange={(v) => setRowEnvelope(index, v)}
      >
        <SelectTrigger className={`bg-[#1A1A1A] border-[#333] text-xs ${compact ? "h-7 w-36" : "h-8 w-40"}`}>
          <SelectValue placeholder="Choose envelope…" />
        </SelectTrigger>
        <SelectContent className="bg-[#0D0D0D] border-[#333]">
          <SelectItem value={SKIP_ROW}>
            <span className="text-muted-foreground">Skip this transaction</span>
          </SelectItem>
          {envelopes.length > 0 && <SelectSeparator />}
          {envelopes.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: e.color }} />
                {e.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  function renderPayeeMappingPanel(index: number, rawPayee: string) {
    const existingAlias = localAliases[rawPayee] ?? matchLongestAlias(rawPayee, loadedAliases)?.canonicalPayee
    const suggestion = matchSuggestions[index] ?? payeeMatchSuggestions[index]
    const isSkippedSuggestion = skippedMatchSuggestions.has(rawPayee)
    const normSuggestion = suggestNormalizedPayee(rawPayee)
    const currentInput = aliasInputs[rawPayee] ?? existingAlias ?? ""

    return (
      <div className="mt-2 rounded-lg bg-[#141414] border border-[#2A2A2A] p-3 space-y-2 text-xs">
        {/* Smart payee suggestion */}
        {suggestion && !existingAlias && !isSkippedSuggestion && (
          <div className={`rounded p-2 border text-xs ${
            suggestion.confidence === "high"
              ? "bg-btc-orange/5 border-btc-orange/20"
              : "bg-[#1A1A1A] border-[#2A2A2A]"
          }`}>
            <p className="text-muted-foreground mb-1">
              {suggestion.confidence === "high"
                ? "We found a match — link these payees?"
                : "Multiple transactions matched — double-check this link."}
            </p>
            <p className="font-medium text-foreground">
              {rawPayee} <span className="text-muted-foreground mx-1">→</span>
              <span className={suggestion.confidence === "high" ? "text-btc-orange" : ""}>
                {suggestion.suggestedAlias}
              </span>
            </p>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => {
                  setAlias(rawPayee, suggestion.suggestedAlias)
                  setExpandedMappingRow(null)
                }}
                className="flex items-center gap-1 px-2 py-1 bg-btc-orange text-[#0D0D0D] rounded text-xs font-medium"
              >
                ✓ Accept
              </button>
              <button
                type="button"
                onClick={() => setSkippedMatchSuggestions(prev => new Set([...prev, rawPayee]))}
                className="px-2 py-1 text-muted-foreground hover:text-foreground"
              >
                ✕ Skip
              </button>
            </div>
          </div>
        )}

        {/* Existing alias or input */}
        {existingAlias ? (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground truncate min-w-0">{rawPayee}</span>
            <span className="text-muted-foreground">→</span>
            <span className="font-medium text-foreground truncate min-w-0">{existingAlias}</span>
            <button
              type="button"
              onClick={() => removeAlias(rawPayee)}
              className="ml-auto shrink-0 p-1 text-muted-foreground hover:text-red-400"
              aria-label="Unlink alias"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            {normSuggestion && (
              <p className="text-muted-foreground">
                Normalize: &ldquo;{rawPayee}&rdquo; → &ldquo;{normSuggestion}&rdquo;&nbsp;
                <button
                  type="button"
                  onClick={() => setAliasInputs(prev => ({ ...prev, [rawPayee]: normSuggestion }))}
                  className="text-btc-orange underline"
                >
                  Use this
                </button>
              </p>
            )}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground shrink-0 text-xs truncate max-w-[120px]">{rawPayee}</span>
              <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
              <div className="relative flex-1">
                <input
                  type="text"
                  value={currentInput}
                  onChange={(e) => setAliasInputs(prev => ({ ...prev, [rawPayee]: e.target.value }))}
                  placeholder="Canonical name…"
                  className="w-full rounded bg-[#1A1A1A] border border-[#333] px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-btc-orange"
                  list={`alias-suggestions-${index}`}
                />
                <datalist id={`alias-suggestions-${index}`}>
                  {payeeSuggestions.slice(0, 20).map(s => <option key={s} value={s} />)}
                </datalist>
              </div>
              <button
                type="button"
                disabled={!currentInput.trim()}
                onClick={() => {
                  if (currentInput.trim()) {
                    setAlias(rawPayee, currentInput.trim())
                    setExpandedMappingRow(null)
                  }
                }}
                className="shrink-0 px-2 py-1 bg-btc-orange text-[#0D0D0D] rounded text-xs font-medium disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  function renderRecurringPanel(index: number) {
    const txn = parsed?.[index]
    if (!txn) return null
    const { payee: txnPayee, amount: txnAmount, type: txnType, date: txnDate } = txn
    const cadence = recurringCadences[index] ?? "monthly"
    const endDate = recurringEndDates[index] ?? ""
    const envId = rowEnvelopes[index]

    async function saveRecurring() {
      if (!envId || envId === SKIP_ROW) return
      const crypto = await resolveImportCrypto()
      if (!crypto) return
      const canonical = resolveCanonicalPayee(txnPayee, localAliases, loadedAliases)
      await fetch("/api/recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payee: await crypto.encrypt(canonical),
          amount: txnAmount,
          type: txnType,
          envelopeId: envId,
          cadence,
          startDate: txnDate,
          ...(endDate ? { endDate } : {}),
          tags: "[]",
          notes: null,
        }),
      }).catch(() => {})
      setExpandedRecurringRow(null)
    }

    return (
      <div className="mt-2 rounded-lg bg-[#141414] border border-[#2A2A2A] p-3 space-y-2 text-xs">
        <p className="text-muted-foreground font-medium">Make recurring</p>
        <div className="flex gap-2 flex-wrap">
          <Select value={cadence} onValueChange={(v) => setRecurringCadences(prev => ({ ...prev, [index]: v }))}>
            <SelectTrigger className="h-7 w-28 bg-[#1A1A1A] border-[#333] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#0D0D0D] border-[#333]">
              {["weekly","biweekly","monthly","quarterly","annual"].map(c => (
                <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setRecurringEndDates(prev => ({ ...prev, [index]: e.target.value }))}
            className="h-7 rounded bg-[#1A1A1A] border border-[#333] px-2 text-xs text-foreground"
            placeholder="End date (optional)"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void saveRecurring()}
            disabled={!envId || envId === SKIP_ROW}
            className="px-3 py-1 bg-btc-orange text-[#0D0D0D] rounded text-xs font-medium disabled:opacity-40"
          >
            Save recurring rule
          </button>
          <button type="button" onClick={() => setExpandedRecurringRow(null)} className="text-muted-foreground px-2">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // ─── Transaction row ──────────────────────────────────────────────────────────
  function renderTransactionRow(t: ParsedTransaction, i: number) {
    const isDupe = duplicateRows.has(i) && !forceImportRows.has(i)
    const isForced = forceImportRows.has(i)
    const isSkipped = rowEnvelopes[i] === SKIP_ROW
    const suggestion = matchSuggestions[i] ?? payeeMatchSuggestions[i]
    const hasHighSuggestion = suggestion?.confidence === "high" && !skippedMatchSuggestions.has(t.payee) && !localAliases[t.payee]
    const hasMedSuggestion = suggestion?.confidence === "medium" && !skippedMatchSuggestions.has(t.payee) && !localAliases[t.payee]
    const displayPayee = resolveDisplayPayee(t.payee, localAliases, loadedAliases)
    const isMappingOpen = expandedMappingRow === i
    const isRecurringOpen = expandedRecurringRow === i
    const creditAction = t.type === "credit" ? effectiveCreditAction(i) : null
    const isCreditSkipped = creditAction?.action === "skip"

    if (isDupe && !isForced && !dupeFilterActive) {
      // In normal mode, show dupes dimmed with "Import anyway"
    }
    if (dupeFilterActive && !isDupe) return null

    return (
      <div
        key={i}
        className={`rounded-lg text-sm transition-opacity ${
          isDupe || isSkipped || isCreditSkipped ? "opacity-40" : "bg-[#1A1A1A]"
        }`}
      >
        <div className="flex items-center gap-2 px-3 py-2">
          {/* Date */}
          <span className="w-14 shrink-0 text-xs text-muted-foreground">
            {t.date.slice(5).replace("-", "/")}
          </span>
          {/* Payee */}
          <div className="flex-1 min-w-0">
            <span className="truncate text-foreground">
              {displayPayee ?? t.payee}
            </span>
            {displayPayee && (
              <span className="text-[10px] text-muted-foreground ml-1">← {t.payee}</span>
            )}
          </div>
          {/* Amount */}
          <span className={`shrink-0 font-medium text-xs ${t.type === "credit" ? "text-green-400" : ""}`}>
            {t.type === "credit" ? "+" : "-"}${formatCurrency(t.amount)}
          </span>
          {/* Payee mapping icon */}
          <button
            type="button"
            onClick={() => setExpandedMappingRow(isMappingOpen ? null : i)}
            className="shrink-0 relative p-1 rounded text-muted-foreground hover:text-foreground"
            aria-label="Payee mapping"
          >
            <Tag className="h-3.5 w-3.5" />
            {hasHighSuggestion && (
              <span className="absolute top-0 right-0 h-2 w-2 rounded-full bg-btc-orange" />
            )}
            {hasMedSuggestion && (
              <span className="absolute top-0 right-0 h-2 w-2 rounded-full bg-muted-foreground" />
            )}
          </button>
          {/* Recurring icon */}
          <button
            type="button"
            onClick={() => setExpandedRecurringRow(isRecurringOpen ? null : i)}
            className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground"
            aria-label="Make recurring"
          >
            <Repeat2 className="h-3.5 w-3.5" />
          </button>
          {/* Envelope select */}
          {t.type === "expense" ? (
            renderEnvelopeSelect(i, true)
          ) : (
            <CreditActionSelect
              action={creditAction!}
              envelopes={envelopes}
              savingsEnvelopeId={savingsEnvelopeId}
              onChange={(action) => setRowCreditActions(prev => ({ ...prev, [i]: action }))}
            />
          )}
          {/* Dupe badge / import anyway */}
          {isDupe && (
            <button
              type="button"
              onClick={() => setForceImportRows(prev => new Set([...prev, i]))}
              className="shrink-0 text-[10px] text-yellow-500 hover:text-yellow-400 whitespace-nowrap"
            >
              Import anyway
            </button>
          )}
          {isForced && (
            <span className="shrink-0 text-[10px] text-yellow-600">Force</span>
          )}
        </div>
        {isMappingOpen && (
          <div className="px-3 pb-3">
            {renderPayeeMappingPanel(i, t.payee)}
          </div>
        )}
        {isRecurringOpen && (
          <div className="px-3 pb-3">
            {renderRecurringPanel(i)}
          </div>
        )}
      </div>
    )
  }

  // ─── Payee group row ─────────────────────────────────────────────────────────
  const [expandedPayeeGroups, setExpandedPayeeGroups] = useState<Set<string>>(new Set())

  function renderPayeeGroupRow(payee: string, rows: number[]) {
    const firstRow = rows[0]!
    const t = parsed![firstRow]!
    const suggestion = matchSuggestions[firstRow] ?? payeeMatchSuggestions[firstRow]
    const hasHighSuggestion = suggestion?.confidence === "high" && !skippedMatchSuggestions.has(payee) && !localAliases[payee]
    const hasMedSuggestion = suggestion?.confidence === "medium" && !skippedMatchSuggestions.has(payee) && !localAliases[payee]
    const displayPayee = resolveDisplayPayee(payee, localAliases, loadedAliases)
    const isMappingOpen = expandedMappingRow === firstRow
    const isExpanded = expandedPayeeGroups.has(payee)
    const currentEnv = rowEnvelopes[firstRow]

    return (
      <div key={payee} className="rounded-lg bg-[#1A1A1A] overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2">
          <button
            type="button"
            onClick={() => {
              const next = new Set(expandedPayeeGroups)
              if (next.has(payee)) next.delete(payee)
              else next.add(payee)
              setExpandedPayeeGroups(next)
            }}
            className="shrink-0 text-muted-foreground"
          >
            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          <div className="flex-1 min-w-0">
            <span className="text-sm text-foreground truncate">
              {displayPayee ?? payee}
            </span>
            {displayPayee && (
              <span className="text-[10px] text-muted-foreground ml-1">← {payee}</span>
            )}
          </div>
          <span className="text-xs text-muted-foreground shrink-0">{rows.length}×</span>
          <button
            type="button"
            onClick={() => setExpandedMappingRow(isMappingOpen ? null : firstRow)}
            className="shrink-0 relative p-1 text-muted-foreground hover:text-foreground"
            aria-label="Payee mapping"
          >
            <Tag className="h-3.5 w-3.5" />
            {hasHighSuggestion && <span className="absolute top-0 right-0 h-2 w-2 rounded-full bg-btc-orange" />}
            {hasMedSuggestion && <span className="absolute top-0 right-0 h-2 w-2 rounded-full bg-muted-foreground" />}
          </button>
          <Select
            value={currentEnv ?? ""}
            onValueChange={(v) => {
              rows.forEach(i => {
                if (!manuallySetRows.has(i) || i === firstRow) setRowEnvelope(i, v, i === firstRow)
              })
            }}
          >
            <SelectTrigger className="h-7 w-36 bg-[#141414] border-[#333] text-xs">
              <SelectValue placeholder="Envelope…" />
            </SelectTrigger>
            <SelectContent className="bg-[#0D0D0D] border-[#333]">
              <SelectItem value={SKIP_ROW}><span className="text-muted-foreground">Skip all</span></SelectItem>
              {envelopes.length > 0 && <SelectSeparator />}
              {envelopes.map(e => (
                <SelectItem key={e.id} value={e.id}>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: e.color }} />
                    {e.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isMappingOpen && (
          <div className="px-3 pb-3">
            {renderPayeeMappingPanel(firstRow, t.payee)}
          </div>
        )}
        {isExpanded && rows.map(i => (
          <div key={i} className="border-t border-[#252525] pl-8">
            {renderTransactionRow(parsed![i]!, i)}
          </div>
        ))}
      </div>
    )
  }

  // ─── Credits section ─────────────────────────────────────────────────────────
  const creditRows = useMemo(() => {
    if (!parsed) return []
    return parsed.map((t, i) => ({ t, i })).filter(({ t }) => t.type === "credit")
  }, [parsed])

  const [creditsExpanded, setCreditsExpanded] = useState(true)

  function renderCreditsSection() {
    if (creditRows.length === 0) return null
    return (
      <div className="rounded-lg border border-[#252525] overflow-hidden">
        <button
          type="button"
          onClick={() => setCreditsExpanded(v => !v)}
          className="flex w-full items-center justify-between px-3 py-2 bg-[#161616] text-xs"
        >
          <span className="font-medium text-foreground">
            Credits ({creditRows.length})
          </span>
          <div className="flex items-center gap-2">
            <Select
              value={creditRoutingMode}
              onValueChange={(v) => setCreditRoutingMode(v as CreditRoutingMode)}
            >
              <SelectTrigger
                className="h-6 text-xs bg-transparent border-[#333] w-44"
                onClick={(e) => e.stopPropagation()}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#0D0D0D] border-[#333]">
                <SelectItem value="skip_income">Skip income-looking credits</SelectItem>
                <SelectItem value="review">Review each individually</SelectItem>
                <SelectItem value="import_all">Import all credits</SelectItem>
              </SelectContent>
            </Select>
            {creditsExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
          </div>
        </button>
        {creditsExpanded && (
          <div className="space-y-1 p-2">
            {creditRows.map(({ t, i }) => renderTransactionRow(t, i))}
          </div>
        )}
      </div>
    )
  }

  // ─── JSX ─────────────────────────────────────────────────────────────────────
  const allDupes = parsed !== null && toImportCount === 0 && duplicateCount > 0

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader className="pr-10">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <DialogTitle className="flex min-w-0 items-center gap-2">
                <FileText className="h-5 w-5 text-btc-orange shrink-0" />
                {dialogTitle}
              </DialogTitle>
              {hasDraftChanges && step !== "importing" && step !== "done" && (
                <button
                  type="button"
                  onClick={() => { childModalOpenRef.current = true; setClearOpen(true) }}
                  className="shrink-0 rounded-lg border border-[#333] bg-[#1A1A1A] px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-[#252525] hover:text-foreground"
                >
                  Clear All
                </button>
              )}
            </div>
            <DialogDescription>
              {step === "upload" && "Upload a bank statement in CSV or PDF format."}
              {step === "file_choice" && `${files.length} files ready — choose how to review them.`}
              {step === "preview" && parsed && (
                <>
                  {parsed.length} transaction{parsed.length !== 1 ? "s" : ""} found
                  {dateRange ? ` · ${dateRange}` : ""}
                  {duplicateCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setDupeFilterActive(v => !v)}
                      className="text-yellow-500 hover:text-yellow-400 ml-0"
                    >
                      {dupeFilterActive
                        ? ` · Showing ${duplicateCount} duplicates · Show all`
                        : ` · ${duplicateCount} already imported`}
                    </button>
                  )}
                </>
              )}
              {step === "confirm" && `Review ${toImportCount} transaction${toImportCount !== 1 ? "s" : ""} before importing.`}
              {step === "importing" && "Encrypting and saving your transactions…"}
              {step === "done" && result && (
                <>Imported {result.imported} transaction{result.imported !== 1 ? "s" : ""}</>
              )}
            </DialogDescription>
          </DialogHeader>

          {/* ── Upload step ── */}
          {step === "upload" && !loading && (
            <div className="flex flex-col gap-4 py-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setIsDragging(false)
                  handleFiles(e.dataTransfer.files)
                }}
                className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors ${
                  isDragging ? "border-btc-orange bg-btc-orange/5" : "border-[#2A2A2A] hover:border-btc-orange/50 hover:bg-[#1A1A1A]"
                }`}
                aria-label="Upload bank statement file"
              >
                <Upload className="h-8 w-8 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">Drop your statement here or click to browse</p>
                  <p className="text-xs text-muted-foreground mt-1">Supported: Fold statement (.csv or .pdf)</p>
                </div>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.pdf"
                multiple
                className="hidden"
                onChange={(e) => { handleFiles(e.target.files); e.target.value = "" }}
                aria-hidden="true"
              />
              {parseError && (
                <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5 text-sm text-red-400">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{parseError}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Upload loading ── */}
          {step === "upload" && loading && (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <Loader2 className="h-8 w-8 animate-spin text-btc-orange" />
              <p className="text-sm text-muted-foreground">Reading file…</p>
            </div>
          )}

          {/* ── File choice step ── */}
          {step === "file_choice" && (
            <div className="flex flex-col gap-4 py-2">
              <p className="text-sm text-muted-foreground">
                You dropped {files.length} files totalling{" "}
                {files.reduce((s, f) => s + f.result.transactions.length, 0)} transactions.
              </p>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setFileMode("individual")}
                  className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl border transition-colors text-left ${
                    fileMode === "individual" ? "border-btc-orange bg-btc-orange/5" : "border-[#2A2A2A] hover:border-[#333]"
                  }`}
                >
                  <SplitSquareHorizontal className="h-5 w-5 text-btc-orange shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Review each statement separately</p>
                    <p className="text-xs text-muted-foreground">Go through each file one at a time with full controls</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setFileMode("merge")}
                  className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl border transition-colors text-left ${
                    fileMode === "merge" ? "border-btc-orange bg-btc-orange/5" : "border-[#2A2A2A] hover:border-[#333]"
                  }`}
                >
                  <Files className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Merge into one import</p>
                    <p className="text-xs text-muted-foreground">Combine all files and review together</p>
                  </div>
                </button>
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5 bg-[#1A1A1A] rounded-lg px-3 py-2">
                {files.map((f, idx) => (
                  <p key={idx}>{f.fileName} · {f.result.transactions.length} transactions</p>
                ))}
              </div>
            </div>
          )}

          {/* ── Preview step ── */}
          {step === "preview" && parsed && (
            <div className="flex flex-col gap-3 py-2 flex-1 min-h-0">
              {/* Stats */}
              <div className="grid grid-cols-2 gap-3 shrink-0">
                <div className="rounded-lg bg-[#1A1A1A] border border-[#252525] px-3 py-2.5">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Total Debits</p>
                  <p className="text-base font-semibold text-foreground mt-0.5">${formatCurrency(totalDebits)}</p>
                </div>
                <div className="rounded-lg bg-[#1A1A1A] border border-[#252525] px-3 py-2.5">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Total Credits</p>
                  <p className="text-base font-semibold text-green-400 mt-0.5">+${formatCurrency(totalCredits)}</p>
                </div>
              </div>

              {/* All-dupes special state */}
              {allDupes ? (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <CheckCircle2 className="h-12 w-12 text-green-500" />
                  <div>
                    <p className="font-medium text-foreground">All caught up!</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      All {duplicateCount} transaction{duplicateCount !== 1 ? "s" : ""} in this file are already in your history.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* View mode toggle */}
                  <div className="flex items-center justify-between shrink-0">
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Transactions</p>
                    <div className="flex gap-1 text-xs">
                      <button
                        type="button"
                        onClick={() => setViewMode("row")}
                        className={`px-2 py-0.5 rounded ${viewMode === "row" ? "bg-[#333] text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        Row
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewMode("payee")}
                        className={`px-2 py-0.5 rounded ${viewMode === "payee" ? "bg-[#333] text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        Payee
                      </button>
                    </div>
                  </div>

                  {/* Credits section */}
                  <div className="shrink-0">{renderCreditsSection()}</div>

                  {/* Transaction list */}
                  <div className="flex-1 overflow-y-auto min-h-0 -mx-6 px-6 space-y-1">
                    {viewMode === "row"
                      ? parsed
                          .map((t, i) => t.type === "expense" ? renderTransactionRow(t, i) : null)
                          .filter(Boolean)
                      : uniquePayees
                          .filter(({ payee }) => {
                            const sample = parsed[parsed.findIndex(t => t.payee === payee)]
                            return sample?.type === "expense"
                          })
                          .map(({ payee, rows }) => renderPayeeGroupRow(payee, rows))
                    }
                  </div>

                  {/* Always Map checkbox */}
                  <div className="flex items-center gap-2 shrink-0 pt-1">
                    <Checkbox
                      id="always-map"
                      checked={alwaysMapEnvelopes}
                      onCheckedChange={(v) => setAlwaysMapEnvelopes(!!v)}
                    />
                    <label htmlFor="always-map" className="text-xs text-muted-foreground cursor-pointer">
                      Remember envelope assignments and payee names for future imports
                    </label>
                  </div>
                </>
              )}

              {importError && (
                <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5 text-sm text-red-400 shrink-0">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{importError}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Confirm step ── */}
          {step === "confirm" && (
            <div className="flex flex-col gap-3 py-2 flex-1 min-h-0">
              <div className="flex-1 overflow-y-auto min-h-0 -mx-6 px-6 space-y-3">
                {confirmGroups.map((group, gi) => {
                  const net = group.rows.reduce((s, { t }) =>
                    t.type === "credit" ? s + t.amount : s - t.amount, 0)
                  return (
                    <div key={gi} className="rounded-xl border border-[#252525] overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 bg-[#1A1A1A]">
                        <div className="flex items-center gap-2">
                          {group.envelope && (
                            <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: group.envelope.color }} />
                          )}
                          <span className="text-sm font-medium text-foreground">
                            {group.envelope?.name ?? "Unassigned"}
                          </span>
                        </div>
                        <span className={`text-sm font-semibold ${net >= 0 ? "text-green-400" : "text-foreground"}`}>
                          {net >= 0 ? "+" : ""}${formatCurrency(Math.abs(net))}
                        </span>
                      </div>
                      <div className="divide-y divide-[#1A1A1A]">
                        {group.rows.map(({ t, i }) => {
                          const displayPayee = resolveDisplayPayee(t.payee, localAliases, loadedAliases)
                          return (
                            <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-[#111] text-xs">
                              <span className="w-12 text-muted-foreground">{t.date.slice(5).replace("-", "/")}</span>
                              <span className="flex-1 min-w-0 truncate text-foreground">{displayPayee ?? t.payee}</span>
                              <span className={t.type === "credit" ? "text-green-400" : ""}>
                                {t.type === "credit" ? "+" : "-"}${formatCurrency(t.amount)}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                {/* Skipped count */}
                {(() => {
                  const skippedCount = parsed
                    ? parsed.filter((_, i) => rowEnvelopes[i] === SKIP_ROW || (duplicateRows.has(i) && !forceImportRows.has(i)) || (parsed[i]!.type === "credit" && effectiveCreditAction(i).action === "skip")).length
                    : 0
                  return skippedCount > 0 ? (
                    <p className="text-xs text-muted-foreground text-center">
                      {skippedCount} transaction{skippedCount !== 1 ? "s" : ""} not importing
                    </p>
                  ) : null
                })()}
              </div>
            </div>
          )}

          {/* ── Importing step ── */}
          {step === "importing" && (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <Loader2 className="h-8 w-8 animate-spin text-btc-orange" />
              <p className="text-sm text-muted-foreground">Encrypting your transactions…</p>
            </div>
          )}

          {/* ── Done step ── */}
          {step === "done" && result && (
            <div className="flex flex-col items-center gap-4 py-6">
              <CheckCircle2 className="h-14 w-14 text-green-500" />
              <div className="text-center space-y-1">
                <p className="text-foreground font-medium text-lg">
                  You successfully imported <span className="text-btc-orange">${formatCurrency(result.totalExpenses)}</span> of transactions.
                </p>
                {result.totalCreditsImported > 0 && (
                  <p className="text-sm text-green-400">+${formatCurrency(result.totalCreditsImported)} in credits imported</p>
                )}
                {result.skipped > 0 && (
                  <p className="text-sm text-muted-foreground">{result.skipped} skipped</p>
                )}
              </div>

              {/* Undo */}
              {result.importBatchId && undoTimeLeft > 0 && (
                <button
                  type="button"
                  onClick={() => void handleUndo()}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[#333] bg-[#1A1A1A] text-sm text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw className="h-4 w-4" />
                  Undo import ({Math.floor(undoTimeLeft / 60)}:{String(undoTimeLeft % 60).padStart(2, "0")})
                </button>
              )}

              {/* View transactions */}
              <button
                type="button"
                onClick={() => { handleOpenChange(false); navigateTo("transactions") }}
                className="text-sm text-btc-orange hover:text-btc-orange/80 underline"
              >
                View transactions →
              </button>

              {/* Auto-import CTA */}
              {showAutoImportCta && institutionName && (
                <div className="rounded-xl border border-[#252525] bg-[#1A1A1A] px-4 py-3 text-center max-w-xs">
                  <Sparkles className="h-5 w-5 text-btc-orange mx-auto mb-1" />
                  {hasPremiumFeatures ? (
                    <p className="text-sm text-foreground">
                      Connect {institutionName} and import automatically →
                    </p>
                  ) : (
                    <p className="text-sm text-foreground">
                      Import {institutionName} automatically with Premium
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Footer ── */}
          <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0 shrink-0">
            {step === "upload" && !loading && (
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                className="px-5 py-2.5 bg-[#1A1A1A] border border-[#333] text-foreground rounded-lg text-sm font-medium hover:bg-[#252525]"
              >
                Cancel
              </button>
            )}

            {step === "file_choice" && (
              <div className="flex w-full gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => { setFiles([]); setStep("upload") }}
                  className="flex items-center gap-1.5 px-4 py-2.5 text-muted-foreground text-sm hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void applyFileChoice()}
                  className="flex items-center gap-2 px-5 py-2.5 bg-btc-orange text-[#0D0D0D] rounded-lg text-sm font-semibold"
                >
                  Continue <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            )}

            {step === "preview" && (
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={resetAndClearDraft}
                  className="flex items-center gap-1.5 px-4 py-2.5 text-muted-foreground text-sm hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                  Different file
                </button>
                {!allDupes && (
                  <button
                    type="button"
                    disabled={toImportCount <= 0}
                    onClick={() => setStep("confirm")}
                    className="flex items-center gap-2 px-5 py-2.5 bg-btc-orange text-[#0D0D0D] rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next <ArrowRight className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}

            {step === "confirm" && (
              <div className="flex w-full gap-2 justify-between">
                <button
                  type="button"
                  onClick={() => setStep("preview")}
                  className="flex items-center gap-1.5 px-4 py-2.5 text-muted-foreground text-sm hover:text-foreground"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Go back
                </button>
                <button
                  type="button"
                  onClick={() => void handleImport()}
                  className="flex items-center gap-2 px-5 py-2.5 bg-btc-orange text-[#0D0D0D] rounded-lg text-sm font-semibold"
                >
                  Import {toImportCount} Transaction{toImportCount !== 1 ? "s" : ""}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            )}

            {step === "done" && (
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                className="px-5 py-2.5 bg-[#1A1A1A] border border-[#333] text-foreground rounded-lg text-sm font-medium hover:bg-[#252525]"
              >
                Done
              </button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear All confirm dialog */}
      <AlertDialog
        open={clearOpen}
        onOpenChange={(next) => {
          if (next) { childModalOpenRef.current = true; setClearOpen(true); return }
          setClearOpen(false)
          setTimeout(() => { childModalOpenRef.current = false }, 0)
        }}
      >
        <AlertDialogContent className="bg-[#0D0D0D] border-[#1F1F1F]">
          <AlertDialogHeader>
            <AlertDialogTitle>Clear this import?</AlertDialogTitle>
            <AlertDialogDescription>
              The parsed statement, envelope assignments, payee mappings, and draft settings will be discarded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#333] bg-[#1A1A1A] hover:bg-[#252525]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { resetAndClearDraft(); setClearOpen(false) }}
              className="bg-btc-orange text-[#0D0D0D] hover:bg-btc-orange/90"
            >
              Clear All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ─── Sub-component: CreditActionSelect ───────────────────────────────────────

function CreditActionSelect({
  action,
  envelopes,
  savingsEnvelopeId,
  onChange,
}: {
  action: RowCreditAction
  envelopes: ExistingEnvelope[]
  savingsEnvelopeId?: string
  onChange: (action: RowCreditAction) => void
}) {
  const value = (() => {
    if (action.action === "skip") return "skip"
    if (action.action === "savings") return "savings"
    if (action.action === "refund") return `refund:${action.envelopeId ?? ""}`
    return action.envelopeId ? `envelope:${action.envelopeId}` : "envelope:"
  })()

  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v === "skip") onChange({ action: "skip" })
        else if (v === "savings") onChange({ action: "savings", envelopeId: savingsEnvelopeId })
        else if (v.startsWith("refund:")) onChange({ action: "refund", envelopeId: v.slice(7) })
        else if (v.startsWith("envelope:")) onChange({ action: "envelope", envelopeId: v.slice(9) })
      }}
    >
      <SelectTrigger className="h-7 w-40 bg-[#1A1A1A] border-[#333] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="bg-[#0D0D0D] border-[#333]">
        <SelectItem value="skip"><span className="text-muted-foreground">Skip credit</span></SelectItem>
        {savingsEnvelopeId && <SelectItem value="savings">→ Savings</SelectItem>}
        <SelectSeparator />
        {envelopes.map((e) => (
          <SelectItem key={e.id} value={`envelope:${e.id}`}>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: e.color }} />
              {e.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
