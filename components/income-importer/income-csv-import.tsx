"use client"

import { useRef, useState, type ChangeEvent } from "react"
import { FileSpreadsheet } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  incomeCsvBucketsToStagedEntries,
  latestYearFromBuckets,
  parseIncomeCsv,
} from "@/lib/income-import-csv"
import type { StagedImportEntry } from "@/components/income-importer/income-calendar"

interface IncomeCsvImportProps {
  onImported: (result: {
    entries: StagedImportEntry[]
    scrollYear: number
    monthCount: number
    skippedRows: number
  }) => void
  onError: (message: string) => void
  disabled?: boolean
}

export function IncomeCsvImport({ onImported, onError, disabled }: IncomeCsvImportProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return

    setLoading(true)
    try {
      const text = await file.text()
      const parsed = parseIncomeCsv(text)
      if (parsed.buckets.length === 0) {
        onError("No valid income rows found. Use Date and Amount columns with positive values.")
        return
      }

      const entries = incomeCsvBucketsToStagedEntries(parsed.buckets) as StagedImportEntry[]
      onImported({
        entries,
        scrollYear: latestYearFromBuckets(parsed.buckets),
        monthCount: parsed.buckets.length,
        skippedRows: parsed.skippedRows,
      })
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not read that CSV file.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        aria-hidden
        onChange={(e) => void handleFile(e)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0 gap-2"
        disabled={disabled || loading}
        onClick={() => inputRef.current?.click()}
      >
        <FileSpreadsheet className="h-4 w-4 text-[#D4AF37]" aria-hidden />
        {loading ? "Reading…" : "Import CSV"}
      </Button>
    </>
  )
}
