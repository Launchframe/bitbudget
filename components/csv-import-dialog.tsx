"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import {
  Upload,
  ArrowRight,
  Plus,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
  Ban,
  Copy,
  AlertCircle,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { parseCSVFile } from "@/lib/csv"
import type { CsvParseResult, ParsedTransaction } from "@/lib/csv"
import type { Transaction } from "@/lib/data"
import { resolveEncryptFnForImport } from "@/lib/resolve-import-encrypt-fn"
import { transactionCollisionKey } from "@/lib/transaction-dedup"

interface SampleTxn {
  date: string
  payee: string
  amount: number
}

interface CsvEnvelope {
  csvName: string
  count: number
  autoMatchId: string | null
  autoMatchName: string | null
  samples: SampleTxn[]
}

interface ExistingEnvelope {
  id: string
  name: string
  color: string
}

type Step = "preview" | "dedup" | "importing" | "done"

type DedupMode = "allDupes" | "someDupes"

const NEW_ENVELOPE = "__new__"
const SKIP_ENVELOPE = "__skip__"
const CSV_PREFIX = "__csv__:"

export type EncryptFn = (plaintext: string) => Promise<string>

function buildExistingByKey(transactions: Transaction[]): Map<string, Transaction> {
  const map = new Map<string, Transaction>()
  for (const t of transactions) {
    const k = transactionCollisionKey({
      date: t.date,
      payee: t.payee,
      amount: t.amount,
      type: t.type,
    })
    if (!map.has(k)) map.set(k, t)
  }
  return map
}

export function CSVImportDialog({
  open,
  onOpenChange,
  file,
  dedupExistingTransactions,
  onImportComplete,
  onImportResult: onImportResultProp,
  onDone,
  onRequestAllocations,
  onTryAnotherFile,
  onLoadingChange,
  onImportError,
  encryptFn: encryptFnProp,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  file: File | null
  /** Transactions already in the app (decrypted). Use [] on pages without loaded app state (e.g. onboarding). */
  dedupExistingTransactions: Transaction[]
  onImportComplete?: () => void
  /** Called when import succeeds so parent can show a summary (e.g. onboarding complete step). */
  onImportResult?: (result: {
    imported: number
    skipped: number
    newEnvelopes: string[]
  }) => void
  onDone?: () => void
  onRequestAllocations?: () => void | Promise<void>
  /** Called when user chooses another file after an all-duplicates result; parent should clear `file`. */
  onTryAnotherFile?: () => void
  /** Called when parsing or import starts/finishes so parent can show loading state. */
  onLoadingChange?: (loading: boolean) => void
  /** Called when import fails so parent can show failure message. */
  onImportError?: (message: string) => void
  encryptFn?: EncryptFn
}) {
  const [step, setStep] = useState<Step>("preview")
  const [dedupMode, setDedupMode] = useState<DedupMode | null>(null)
  const [duplicateRows, setDuplicateRows] = useState<
    { index: number; incoming: ParsedTransaction; existing: Transaction }[]
  >([])
  const [discardDupIndices, setDiscardDupIndices] = useState<Set<number>>(new Set())
  const [parseResult, setParseResult] = useState<CsvParseResult | null>(null)
  const [csvEnvelopes, setCsvEnvelopes] = useState<CsvEnvelope[]>([])
  const [existingEnvelopes, setExistingEnvelopes] = useState<ExistingEnvelope[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ imported: number; skipped: number; newEnvelopes: string[] } | null>(null)
  const [requestingAllocations, setRequestingAllocations] = useState(false)
  const [expandedDupIndex, setExpandedDupIndex] = useState<number | null>(null)

  const lastLoadedFile = useRef<File | null>(null)
  const deferredImportRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearDeferredImport = useCallback(() => {
    if (deferredImportRef.current) {
      clearTimeout(deferredImportRef.current)
      deferredImportRef.current = null
    }
  }, [])

  useEffect(() => () => clearDeferredImport(), [clearDeferredImport])

  useEffect(() => {
    if (!open) setRequestingAllocations(false)
  }, [open])

  useEffect(() => {
    if (!open || !file || file === lastLoadedFile.current) return
    lastLoadedFile.current = file

    async function loadPreview() {
      setLoading(true)
      onLoadingChange?.(true)
      setError(null)
      setStep("preview")
      setDedupMode(null)
      setDuplicateRows([])
      setDiscardDupIndices(new Set())
      setExpandedDupIndex(null)
      setResult(null)
      setParseResult(null)
      setCsvEnvelopes([])
      try {
        const text = await file!.text()
        const parsed = parseCSVFile(text)
        setParseResult(parsed)

        const envRes = await fetch("/api/envelopes")
        const userEnvelopes: ExistingEnvelope[] = envRes.ok ? await envRes.json() : []
        setExistingEnvelopes(userEnvelopes)

        const existingByLower: Record<string, { id: string; name: string }> = {}
        for (const e of userEnvelopes) {
          existingByLower[e.name.toLowerCase()] = { id: e.id, name: e.name }
        }

        const envelopes = Object.entries(parsed.envelopeCounts)
          .sort(([, a], [, b]) => b - a)
          .map(([name, count]): CsvEnvelope => {
            const match = existingByLower[name.toLowerCase()]
            return {
              csvName: name,
              count,
              autoMatchId: match?.id ?? null,
              autoMatchName: match?.name ?? null,
              samples: parsed.envelopeSamples[name] ?? [],
            }
          })
        setCsvEnvelopes(envelopes)

        const initialMapping: Record<string, string> = {}
        for (const env of envelopes) {
          initialMapping[env.csvName] = env.autoMatchId ?? NEW_ENVELOPE
        }
        setMapping(initialMapping)

        const skipEnv = new Set(
          Object.entries(initialMapping)
            .filter(([, v]) => v === SKIP_ENVELOPE)
            .map(([k]) => k.toLowerCase())
        )
        const existingByKey = buildExistingByKey(dedupExistingTransactions)
        const eligibleIndices: number[] = []
        const dupRows: { index: number; incoming: ParsedTransaction; existing: Transaction }[] = []
        for (let i = 0; i < parsed.transactions.length; i++) {
          const txn = parsed.transactions[i]
          if (skipEnv.has(txn.envelopeName.toLowerCase())) continue
          eligibleIndices.push(i)
          const k = transactionCollisionKey({
            date: txn.date,
            payee: txn.payee,
            amount: txn.amount,
            type: txn.type,
          })
          const existing = existingByKey.get(k)
          if (existing) dupRows.push({ index: i, incoming: txn, existing })
        }
        if (eligibleIndices.length > 0 && dupRows.length === eligibleIndices.length) {
          setDuplicateRows(dupRows)
          setDedupMode("allDupes")
          setStep("dedup")
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to preview CSV"
        setError(msg)
        onImportError?.(msg)
      } finally {
        setLoading(false)
        onLoadingChange?.(false)
      }
    }

    loadPreview()
  }, [open, file, dedupExistingTransactions, onLoadingChange, onImportError])

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        clearDeferredImport()
        setParseResult(null)
        setCsvEnvelopes([])
        setExistingEnvelopes([])
        setMapping({})
        setError(null)
        setResult(null)
        setStep("preview")
        setDedupMode(null)
        setDuplicateRows([])
        setDiscardDupIndices(new Set())
        setExpandedDupIndex(null)
        lastLoadedFile.current = null
      }
      onOpenChange(isOpen)
    },
    [onOpenChange, clearDeferredImport],
  )

  const skippedNames = useCallback(() => {
    return new Set(
      Object.entries(mapping)
        .filter(([, v]) => v === SKIP_ENVELOPE)
        .map(([k]) => k.toLowerCase()),
    )
  }, [mapping])

  const runImport = async (dupIndices: Set<number>, discardIndices: Set<number>) => {
    if (!parseResult) return
    setStep("importing")
    onLoadingChange?.(true)
    setError(null)
    try {
      const encrypt = encryptFnProp ?? (await resolveEncryptFnForImport())
      if (!encrypt) {
        throw new Error(
          "Encryption key not available. If you use a Nostr extension, approve the decrypt prompt (NIP-04). " +
            "If you unlock with a PIN (web2-style / nsec fallback), open the main app and unlock with your PIN or passphrase, then try again.",
        )
      }

      const skipEnv = skippedNames()

      const encryptedTxns: {
        date: string
        payee: string
        amount: number
        type: string
        envelopeName: string
        notes: string | null
      }[] = []

      for (let i = 0; i < parseResult.transactions.length; i++) {
        const txn = parseResult.transactions[i]
        if (skipEnv.has(txn.envelopeName.toLowerCase())) continue
        if (dupIndices.has(i) && discardIndices.has(i)) continue

        const encPayee = await encrypt(txn.payee)
        const encNotes = txn.notes ? await encrypt(txn.notes) : null

        encryptedTxns.push({
          date: txn.date,
          payee: encPayee,
          amount: txn.amount,
          type: txn.type,
          envelopeName: txn.envelopeName,
          notes: encNotes,
        })
      }

      if (encryptedTxns.length === 0) {
        const msg = "No transactions left to import."
        setError(msg)
        onImportError?.(msg)
        setStep("dedup")
        onLoadingChange?.(false)
        return
      }

      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactions: encryptedTxns,
          envelopeMapping: mapping,
        }),
      })

      if (!res.ok) {
        let data: { error?: string }
        try {
          data = await res.json()
        } catch {
          throw new Error("Import failed")
        }
        throw new Error(data.error || "Import failed")
      }
      let data: { imported?: number; skipped?: number; newEnvelopes?: string[] }
      try {
        data = await res.json()
      } catch {
        throw new Error("Import failed")
      }
      const summary = {
        imported: data.imported ?? 0,
        skipped: data.skipped ?? 0,
        newEnvelopes: data.newEnvelopes ?? [],
      }
      setResult(summary)
      onImportResultProp?.(summary)
      setStep("done")
      onLoadingChange?.(false)
      if (onImportComplete) await onImportComplete()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed"
      setError(msg)
      onImportError?.(msg)
      onLoadingChange?.(false)
      setStep(dedupMode ? "dedup" : "preview")
    }
  }

  const handlePreviewImportClick = () => {
    if (!parseResult) return
    setStep("importing")
    onLoadingChange?.(true)
    setError(null)
    clearDeferredImport()
    deferredImportRef.current = setTimeout(() => {
      deferredImportRef.current = null
      const skipEnv = skippedNames()
      const existingByKey = buildExistingByKey(dedupExistingTransactions)

      const eligibleIndices: number[] = []
      const dupRows: { index: number; incoming: ParsedTransaction; existing: Transaction }[] = []

      for (let i = 0; i < parseResult.transactions.length; i++) {
        const txn = parseResult.transactions[i]
        if (skipEnv.has(txn.envelopeName.toLowerCase())) continue
        eligibleIndices.push(i)
        const k = transactionCollisionKey({
          date: txn.date,
          payee: txn.payee,
          amount: txn.amount,
          type: txn.type,
        })
        const existing = existingByKey.get(k)
        if (existing) {
          dupRows.push({ index: i, incoming: txn, existing })
        }
      }

      if (eligibleIndices.length === 0) {
        setStep("preview")
        onLoadingChange?.(false)
        return
      }

      if (dupRows.length === 0) {
        void runImport(new Set(), new Set())
        return
      }

      if (dupRows.length === eligibleIndices.length) {
        setDedupMode("allDupes")
        setDuplicateRows(dupRows)
        setStep("dedup")
        onLoadingChange?.(false)
        return
      }

      setDedupMode("someDupes")
      setDuplicateRows(dupRows)
      setDiscardDupIndices(new Set(dupRows.map((r) => r.index)))
      setStep("dedup")
      onLoadingChange?.(false)
    }, 0)
  }

  const dupIndexSet = new Set(duplicateRows.map((r) => r.index))
  const toImportFromDedup =
    parseResult == null
      ? 0
      : parseResult.transactions.filter((txn, i) => {
          if (skippedNames().has(txn.envelopeName.toLowerCase())) return false
          if (dupIndexSet.has(i) && discardDupIndices.has(i)) return false
          return true
        }).length

  const totalRows = parseResult?.totalRows ?? 0
  const skippedEnvelopes = csvEnvelopes.filter(e => mapping[e.csvName] === SKIP_ENVELOPE)
  const skippedTxnCount = skippedEnvelopes.reduce((sum, e) => sum + e.count, 0)
  const importTxnCount = totalRows - (parseResult?.skippedRows ?? 0) - skippedTxnCount

  const unmatchedCount = csvEnvelopes.filter(e => mapping[e.csvName] === NEW_ENVELOPE).length
  const matchedCount = csvEnvelopes.filter(e => {
    const v = mapping[e.csvName]
    return v !== NEW_ENVELOPE && v !== SKIP_ENVELOPE
  }).length

  const newEnvelopeNames = csvEnvelopes
    .filter(e => mapping[e.csvName] === NEW_ENVELOPE)
    .map(e => e.csvName)

  const envelopeNameById = (id: string) => existingEnvelopes.find((e) => e.id === id)?.name ?? id

  function toggleDiscardDup(index: number) {
    setDiscardDupIndices((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-[#F7931A]" />
            {step === "done"
              ? "Import Complete"
              : step === "dedup" && dedupMode === "allDupes"
                ? "Already imported"
                : step === "dedup"
                  ? "Review duplicates"
                  : "Import Transactions"}
          </DialogTitle>
          <DialogDescription>
            {step === "preview" && parseResult && (
              <>
                {totalRows} transactions found across {csvEnvelopes.length} categories.
                {skippedTxnCount > 0 && (
                  <span className="text-yellow-500"> ({skippedTxnCount} will be skipped)</span>
                )}
              </>
            )}
            {step === "dedup" && dedupMode === "someDupes" && (
              <>
                {duplicateRows.length} duplicate{duplicateRows.length !== 1 ? "s" : ""} detected.{" "}
                {toImportFromDedup} transaction{toImportFromDedup !== 1 ? "s" : ""} will be imported
                {discardDupIndices.size < duplicateRows.length ? " (including duplicates you keep)" : ""}.
              </>
            )}
            {step === "dedup" && dedupMode === "allDupes" && (
              <>Every transaction in this file matches one you already have.</>
            )}
            {step === "done" && result && (
              <>
                {result.imported} transactions imported
                {result.newEnvelopes.length > 0 && (
                  <> including {result.newEnvelopes.length} new envelope{result.newEnvelopes.length === 1 ? "" : "s"}</>
                )}
                . {result.skipped > 0 ? result.skipped : "No"} transactions were skipped.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[#F7931A]" />
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {step === "preview" && parseResult && !loading && (
          <div className="flex-1 overflow-y-auto min-h-0 -mx-6 px-6">
            <div className="flex items-center gap-4 mb-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                {matchedCount} matched
              </span>
              <span className="flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5 text-[#F7931A]" />
                {unmatchedCount} new
              </span>
              {skippedEnvelopes.length > 0 && (
                <span className="flex items-center gap-1.5">
                  <Ban className="h-3.5 w-3.5 text-yellow-500" />
                  {skippedEnvelopes.length} skipped
                </span>
              )}
            </div>

            <div className="space-y-2">
              {csvEnvelopes.map((env) => (
                <EnvelopeMappingRow
                  key={env.csvName}
                  csvEnvelope={env}
                  existingEnvelopes={existingEnvelopes}
                  newEnvelopeNames={newEnvelopeNames}
                  value={mapping[env.csvName] ?? NEW_ENVELOPE}
                  onChange={(val) =>
                    setMapping((prev) => ({ ...prev, [env.csvName]: val }))
                  }
                />
              ))}
            </div>
          </div>
        )}

        {step === "dedup" && dedupMode === "allDupes" && (
          <div className="flex flex-col items-center gap-4 py-8 px-2">
            <div className="p-4 rounded-full bg-muted/20">
              <Copy className="h-10 w-10 text-muted-foreground" />
            </div>
            <p className="text-center text-foreground font-medium">
              It looks like you&apos;ve already imported all these transactions.
            </p>
            <p className="text-center text-sm text-muted-foreground max-w-md">
              We matched every row in this file to an existing transaction (same date, payee, and amount).
            </p>
          </div>
        )}

        {step === "dedup" && dedupMode === "someDupes" && (
          <div className="flex-1 overflow-y-auto min-h-0 -mx-6 px-6 space-y-3">
            <p className="text-xs text-muted-foreground">
              Checked rows are skipped (duplicates). Uncheck a row if you still want to import that transaction.
            </p>
            <div className="space-y-2">
              {duplicateRows.map((row) => {
                const discard = discardDupIndices.has(row.index)
                const expanded = expandedDupIndex === row.index
                return (
                  <div
                    key={row.index}
                    className="rounded-lg border border-[#252525] bg-[#1A1A1A] overflow-hidden"
                  >
                    <div className="flex items-center gap-3 p-3">
                      <Checkbox
                        checked={discard}
                        onCheckedChange={() => toggleDiscardDup(row.index)}
                        aria-label={discard ? "Skip duplicate" : "Import duplicate"}
                      />
                      <button
                        type="button"
                        onClick={() => setExpandedDupIndex(expanded ? null : row.index)}
                        className="p-0.5 rounded hover:bg-[#252525] text-muted-foreground shrink-0"
                        aria-expanded={expanded}
                      >
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
                      </button>
                      <div className="flex-1 min-w-0 text-xs">
                        <div className="text-muted-foreground">{row.incoming.date}</div>
                        <div className="text-foreground truncate font-medium">{row.incoming.payee}</div>
                        <div className="text-foreground">${row.incoming.amount.toFixed(2)}</div>
                      </div>
                      <span className="text-[10px] uppercase text-yellow-600/90 shrink-0">Duplicate</span>
                    </div>
                    {expanded && (
                      <div className="border-t border-[#252525] px-3 py-2 bg-[#111] text-xs space-y-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" /> Existing transaction
                        </p>
                        <div className="grid gap-1 pl-1">
                          <div>
                            <span className="text-muted-foreground">Date: </span>
                            {row.existing.date}
                          </div>
                          <div>
                            <span className="text-muted-foreground">Payee: </span>
                            {row.existing.payee}
                          </div>
                          <div>
                            <span className="text-muted-foreground">Amount: </span>${row.existing.amount.toFixed(2)}
                          </div>
                          <div>
                            <span className="text-muted-foreground">Envelope: </span>
                            {envelopeNameById(row.existing.envelopeId)}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center gap-4 py-6">
            <CheckCircle2 className="h-14 w-14 text-green-500" />
            {result && result.newEnvelopes.length > 0 && (
              <div className="w-full rounded-lg bg-[#F7931A]/10 border border-[#F7931A]/20 px-4 py-3 text-sm">
                <p className="text-foreground text-sm font-medium">
                  You have new envelopes to set up. Would you like to go back and configure them?
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0">
          {step === "preview" && parseResult && !loading && (
            <button
              type="button"
              onClick={handlePreviewImportClick}
              disabled={importTxnCount <= 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#F7931A] text-[#0D0D0D] rounded-lg text-sm font-semibold hover:bg-[#F7931A]/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Import {importTxnCount > 0 ? importTxnCount : 0} Transaction{importTxnCount !== 1 ? "s" : ""}
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
          {step === "dedup" && dedupMode === "allDupes" && (
            <>
              <button
                type="button"
                onClick={() => {
                  onTryAnotherFile?.()
                  handleOpenChange(false)
                }}
                className="px-5 py-2.5 bg-[#1A1A1A] border border-[#333] text-foreground rounded-lg text-sm font-medium hover:bg-[#252525] transition-colors"
              >
                Try another file
              </button>
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                className="px-5 py-2.5 bg-[#F7931A] text-[#0D0D0D] rounded-lg text-sm font-semibold hover:bg-[#F7931A]/90 transition-colors"
              >
                OK
              </button>
            </>
          )}
          {step === "dedup" && dedupMode === "someDupes" && (
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setStep("preview")
                  setDedupMode(null)
                  setDuplicateRows([])
                  setDiscardDupIndices(new Set())
                }}
                className="px-5 py-2.5 text-muted-foreground text-sm hover:text-foreground"
              >
                Back
              </button>
              <button
                type="button"
                disabled={toImportFromDedup <= 0}
                onClick={() => {
                  setStep("importing")
                  onLoadingChange?.(true)
                  setError(null)
                  clearDeferredImport()
                  deferredImportRef.current = setTimeout(() => {
                    deferredImportRef.current = null
                    void runImport(dupIndexSet, discardDupIndices)
                  }, 0)
                }}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#F7931A] text-[#0D0D0D] rounded-lg text-sm font-semibold hover:bg-[#F7931A]/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Import {toImportFromDedup} Transaction{toImportFromDedup !== 1 ? "s" : ""}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}
          {step === "importing" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Encrypting &amp; importing...
            </div>
          )}
          {step === "done" && result && result.newEnvelopes.length > 0 && (
            <div className="flex w-full flex-wrap gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  onDone?.()
                  handleOpenChange(false)
                }}
                className="px-5 py-2.5 bg-[#1A1A1A] border border-[#333] text-foreground rounded-lg text-sm font-medium hover:bg-[#252525] transition-colors"
              >
                Skip
              </button>
              <button
                type="button"
                disabled={requestingAllocations}
                onClick={async () => {
                  setRequestingAllocations(true)
                  setError(null)
                  try {
                    await Promise.resolve(onRequestAllocations?.())
                    handleOpenChange(false)
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Could not open budget allocations. Please try again.",
                    )
                  } finally {
                    setRequestingAllocations(false)
                  }
                }}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#F7931A] text-[#0D0D0D] rounded-lg text-sm font-semibold hover:bg-[#F7931A]/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {requestingAllocations ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    Loading…
                  </>
                ) : (
                  "Back to envelopes"
                )}
              </button>
            </div>
          )}
          {step === "done" && result && result.newEnvelopes.length === 0 && (
            <button
              type="button"
              onClick={() => {
                onDone?.()
                handleOpenChange(false)
              }}
              className="px-5 py-2.5 bg-[#1A1A1A] border border-[#333] text-foreground rounded-lg text-sm font-medium hover:bg-[#252525] transition-colors"
            >
              Done
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EnvelopeMappingRow({
  csvEnvelope,
  existingEnvelopes,
  newEnvelopeNames,
  value,
  onChange,
}: {
  csvEnvelope: CsvEnvelope
  existingEnvelopes: ExistingEnvelope[]
  newEnvelopeNames: string[]
  value: string
  onChange: (value: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isNew = value === NEW_ENVELOPE
  const isSkipped = value === SKIP_ENVELOPE
  const isCsvRef = value.startsWith(CSV_PREFIX)
  const hasSamples = csvEnvelope.samples.length > 0

  const otherNewEnvelopes = newEnvelopeNames.filter(n => n !== csvEnvelope.csvName)

  const statusLabel = isSkipped ? "Skip" : isNew ? "New" : "Mapped"
  const statusColor = isSkipped ? "text-yellow-500" : isNew ? "text-[#F7931A]" : "text-green-500"

  return (
    <div className={`rounded-lg border transition-colors ${isSkipped ? "bg-[#1A1A1A]/50 border-[#252525] opacity-60" : "bg-[#1A1A1A] border-[#252525]"}`}>
      <div className="flex items-center gap-3 p-3">
        {hasSamples && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="p-0.5 rounded hover:bg-[#252525] text-muted-foreground transition-colors shrink-0"
            aria-label={expanded ? "Collapse samples" : "Show samples"}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
          </button>
        )}
        {!hasSamples && <div className="w-5 shrink-0" />}

        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground truncate">
            {csvEnvelope.csvName}
          </div>
          <div className="text-xs text-muted-foreground">
            {csvEnvelope.count} transaction{csvEnvelope.count !== 1 ? "s" : ""}
          </div>
        </div>

        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground hidden sm:block" />

        <div className="w-44 sm:w-52 shrink-0">
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger className="w-full bg-[#0D0D0D] border-[#333] text-sm h-9">
              <SelectValue>
                {isCsvRef ? (
                  <span className="flex items-center gap-1.5 text-sm">
                    <Plus className="h-3 w-3 text-[#F7931A] shrink-0" />
                    <span className="truncate">{value.slice(CSV_PREFIX.length)}</span>
                  </span>
                ) : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-[#0D0D0D] border-[#333]">
              <SelectItem value={NEW_ENVELOPE}>
                <span className="flex items-center gap-1.5">
                  <Plus className="h-3 w-3 text-[#F7931A]" />
                  Create &ldquo;{csvEnvelope.csvName}&rdquo;
                </span>
              </SelectItem>
              <SelectItem value={SKIP_ENVELOPE}>
                <span className="flex items-center gap-1.5">
                  <Ban className="h-3 w-3 text-yellow-500" />
                  Skip
                </span>
              </SelectItem>
              {existingEnvelopes.length > 0 && <SelectSeparator />}
              {existingEnvelopes.map((env) => (
                <SelectItem key={env.id} value={env.id}>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: env.color }}
                    />
                    {env.name}
                  </span>
                </SelectItem>
              ))}
              {otherNewEnvelopes.length > 0 && <SelectSeparator />}
              {otherNewEnvelopes.map((name) => (
                <SelectItem key={`csv-${name}`} value={`${CSV_PREFIX}${name}`}>
                  <span className="flex items-center gap-1.5">
                    <Plus className="h-3 w-3 text-[#F7931A]" />
                    <span className="truncate">{name}</span>
                    <span className="text-[10px] text-muted-foreground">(new)</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <span className={`text-xs shrink-0 w-14 text-right hidden sm:block ${statusColor}`}>
          {statusLabel}
        </span>
      </div>

      {expanded && hasSamples && (
        <div className="border-t border-[#252525] px-3 py-2 ml-5 sm:ml-8">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Sample transactions</p>
          <div className="space-y-1">
            {csvEnvelope.samples.map((s, i) => (
              <div key={i} className="flex items-center justify-between gap-4 text-xs">
                <span className="text-muted-foreground shrink-0">{s.date}</span>
                <span className="text-foreground truncate flex-1">{s.payee}</span>
                <span className={`shrink-0 font-medium ${s.amount < 0 ? "text-[#F7931A]" : "text-green-500"}`}>
                  ${Math.abs(s.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
