"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Upload, ArrowRight, Plus, CheckCircle2, Loader2 } from "lucide-react"
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

interface CsvEnvelope {
  csvName: string
  count: number
  autoMatchId: string | null
  autoMatchName: string | null
}

interface ExistingEnvelope {
  id: string
  name: string
  color: string
}

interface PreviewData {
  totalRows: number
  csvEnvelopes: CsvEnvelope[]
  existingEnvelopes: ExistingEnvelope[]
}

type Step = "preview" | "importing" | "done"

const NEW_ENVELOPE = "__new__"

export function CSVImportDialog({
  open,
  onOpenChange,
  file,
  onImportComplete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  file: File | null
  onImportComplete?: () => void
}) {
  const [step, setStep] = useState<Step>("preview")
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null)

  const lastLoadedFile = useRef<File | null>(null)

  useEffect(() => {
    if (!open || !file || file === lastLoadedFile.current) return
    lastLoadedFile.current = file

    async function loadPreview() {
      setLoading(true)
      setError(null)
      setStep("preview")
      setResult(null)
      setPreview(null)
      try {
        const formData = new FormData()
        formData.append("file", file!)
        const res = await fetch("/api/import/preview", { method: "POST", body: formData })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || "Preview failed")
        }
        const data: PreviewData = await res.json()
        setPreview(data)

        const initialMapping: Record<string, string> = {}
        for (const env of data.csvEnvelopes) {
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
        setPreview(null)
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
    if (!file) return
    setStep("importing")
    setError(null)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("envelopeMapping", JSON.stringify(mapping))
      const res = await fetch("/api/import", { method: "POST", body: formData })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Import failed")
      }
      const data = await res.json()
      setResult({ imported: data.imported, skipped: data.skipped })
      setStep("done")
      if (onImportComplete) await onImportComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed")
      setStep("preview")
    }
  }

  const unmatchedCount = preview
    ? preview.csvEnvelopes.filter(e => mapping[e.csvName] === NEW_ENVELOPE).length
    : 0

  const matchedCount = preview
    ? preview.csvEnvelopes.length - unmatchedCount
    : 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-[#F7931A]" />
            {step === "done" ? "Import Complete" : "Import Transactions"}
          </DialogTitle>
          <DialogDescription>
            {step === "preview" && preview && (
              <>
                {preview.totalRows} transactions found. Map CSV envelope names to your existing envelopes below.
              </>
            )}
            {step === "importing" && "Importing transactions..."}
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

        {step === "preview" && preview && !loading && (
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
            </div>

            <div className="space-y-2">
              {preview.csvEnvelopes.map((env) => (
                <EnvelopeMappingRow
                  key={env.csvName}
                  csvEnvelope={env}
                  existingEnvelopes={preview.existingEnvelopes}
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
          <div className="flex items-center justify-center py-8">
            <CheckCircle2 className="h-16 w-16 text-green-500" />
          </div>
        )}

        <DialogFooter>
          {step === "preview" && preview && !loading && (
            <button
              onClick={handleImport}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#F7931A] text-[#0D0D0D] rounded-lg text-sm font-semibold hover:bg-[#F7931A]/90 transition-colors"
            >
              Import {preview.totalRows} Transactions
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
          {step === "importing" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Importing...
            </div>
          )}
          {step === "done" && (
            <button
              onClick={() => handleOpenChange(false)}
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
  value,
  onChange,
}: {
  csvEnvelope: CsvEnvelope
  existingEnvelopes: ExistingEnvelope[]
  value: string
  onChange: (value: string) => void
}) {
  const isNew = value === NEW_ENVELOPE

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-[#1A1A1A] border border-[#252525]">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground truncate">
          {csvEnvelope.csvName}
        </div>
        <div className="text-xs text-muted-foreground">
          {csvEnvelope.count} transaction{csvEnvelope.count !== 1 ? "s" : ""}
        </div>
      </div>

      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />

      <div className="w-52 shrink-0">
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="w-full bg-[#0D0D0D] border-[#333] text-sm h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#0D0D0D] border-[#333]">
            <SelectItem value={NEW_ENVELOPE}>
              <span className="flex items-center gap-1.5">
                <Plus className="h-3 w-3 text-[#F7931A]" />
                Create new envelope
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
          </SelectContent>
        </Select>
      </div>

      <span className="text-xs shrink-0 w-14 text-right">
        {isNew ? (
          <span className="text-[#F7931A]">New</span>
        ) : (
          <span className="text-green-500">Mapped</span>
        )}
      </span>
    </div>
  )
}
