"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Upload, ArrowRight, Plus, CheckCircle2, Loader2, ChevronDown, ChevronRight as ChevronRightIcon, Ban } from "lucide-react"
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
import { parseCSVFile } from "@/lib/csv"
import type { CsvParseResult } from "@/lib/csv"
import { encryptField, hexToUint8 } from "@/lib/crypto"

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

type Step = "preview" | "importing" | "done"

const NEW_ENVELOPE = "__new__"
const SKIP_ENVELOPE = "__skip__"
const CSV_PREFIX = "__csv__:"

export type EncryptFn = (plaintext: string) => Promise<string>

function getSessionEncryptFn(): EncryptFn | null {
  const hex = sessionStorage.getItem("bitbudget-privacy-key")
  if (!hex) return null
  const key = hexToUint8(hex)
  return (plaintext: string) => encryptField(plaintext, key)
}

export function CSVImportDialog({
  open,
  onOpenChange,
  file,
  onImportComplete,
  onDone,
  encryptFn: encryptFnProp,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  file: File | null
  onImportComplete?: () => void
  onDone?: () => void
  encryptFn?: EncryptFn
}) {
  const [step, setStep] = useState<Step>("preview")
  const [parseResult, setParseResult] = useState<CsvParseResult | null>(null)
  const [csvEnvelopes, setCsvEnvelopes] = useState<CsvEnvelope[]>([])
  const [existingEnvelopes, setExistingEnvelopes] = useState<ExistingEnvelope[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ imported: number; skipped: number; newEnvelopes: string[] } | null>(null)

  const lastLoadedFile = useRef<File | null>(null)

  useEffect(() => {
    if (!open || !file || file === lastLoadedFile.current) return
    lastLoadedFile.current = file

    async function loadPreview() {
      setLoading(true)
      setError(null)
      setStep("preview")
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
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to preview CSV")
      } finally {
        setLoading(false)
      }
    }

    loadPreview()
  }, [open, file])

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        setParseResult(null)
        setCsvEnvelopes([])
        setExistingEnvelopes([])
        setMapping({})
        setError(null)
        setResult(null)
        setStep("preview")
        lastLoadedFile.current = null
      }
      onOpenChange(isOpen)
    },
    [onOpenChange],
  )

  const handleImport = async () => {
    if (!parseResult) return
    setStep("importing")
    setError(null)
    try {
      const encrypt = encryptFnProp ?? getSessionEncryptFn()
      if (!encrypt) {
        throw new Error("Encryption key not available. Please unlock your account and try again.")
      }

      const skippedNames = new Set(
        Object.entries(mapping)
          .filter(([, v]) => v === SKIP_ENVELOPE)
          .map(([k]) => k.toLowerCase()),
      )

      const encryptedTxns: {
        date: string
        payee: string
        amount: number
        type: string
        envelopeName: string
        notes: string | null
      }[] = []

      for (const txn of parseResult.transactions) {
        if (skippedNames.has(txn.envelopeName.toLowerCase())) continue

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

      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactions: encryptedTxns,
          envelopeMapping: mapping,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Import failed")
      }
      const data = await res.json()
      setResult({ imported: data.imported, skipped: data.skipped, newEnvelopes: data.newEnvelopes ?? [] })
      setStep("done")
      if (onImportComplete) await onImportComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed")
      setStep("preview")
    }
  }

  const totalRows = parseResult?.totalRows ?? 0

  const skippedEnvelopes = csvEnvelopes.filter(e => mapping[e.csvName] === SKIP_ENVELOPE)
  const skippedTxnCount = skippedEnvelopes.reduce((sum, e) => sum + e.count, 0)
  const importTxnCount = totalRows - parseResult?.skippedRows! - skippedTxnCount

  const unmatchedCount = csvEnvelopes.filter(e => mapping[e.csvName] === NEW_ENVELOPE).length
  const matchedCount = csvEnvelopes.filter(e => {
    const v = mapping[e.csvName]
    return v !== NEW_ENVELOPE && v !== SKIP_ENVELOPE
  }).length

  const newEnvelopeNames = csvEnvelopes
    .filter(e => mapping[e.csvName] === NEW_ENVELOPE)
    .map(e => e.csvName)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-[#F7931A]" />
            {step === "done" ? "Import Complete" : "Import Transactions"}
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
            {step === "importing" && "Encrypting and importing transactions..."}
            {step === "done" && result && (
              <>
                {result.imported} transactions imported, {result.skipped} skipped.
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

        {step === "done" && (
          <div className="flex flex-col items-center gap-4 py-6">
            <CheckCircle2 className="h-14 w-14 text-green-500" />
            {result && result.newEnvelopes.length > 0 && (
              <div className="w-full rounded-lg bg-[#F7931A]/10 border border-[#F7931A]/20 px-4 py-3 text-sm">
                <p className="font-medium text-foreground mb-1">
                  {result.newEnvelopes.length} new envelope{result.newEnvelopes.length !== 1 ? "s" : ""} created
                </p>
                <p className="text-muted-foreground text-xs mb-2">
                  {result.newEnvelopes.join(", ")}
                </p>
                <p className="text-muted-foreground text-xs">
                  These envelopes have no monthly allotment yet. Set your income allocations on the Envelopes page.
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === "preview" && parseResult && !loading && (
            <button
              onClick={handleImport}
              disabled={importTxnCount <= 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#F7931A] text-[#0D0D0D] rounded-lg text-sm font-semibold hover:bg-[#F7931A]/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Import {importTxnCount > 0 ? importTxnCount : 0} Transaction{importTxnCount !== 1 ? "s" : ""}
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
          {step === "importing" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Encrypting &amp; importing...
            </div>
          )}
          {step === "done" && (
            <button
              onClick={() => { onDone?.(); handleOpenChange(false) }}
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
