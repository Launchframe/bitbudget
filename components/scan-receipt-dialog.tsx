"use client"

import { useState, useRef, useEffect } from "react"
import { useApp } from "@/lib/app-context"
import type { ParsedTransaction } from "@/lib/csv"
import type { FoldStatementMeta } from "@/lib/fold-pdf-parser"
import { PremiumLockedLabel } from "@/components/premium-locked-label"
import { PREMIUM_UI_COPY } from "@/lib/premium-ui-copy"
import { RECEIPT_SCAN_MAX_BYTES } from "@/lib/receipt-scan-validate"
import type { ReceiptScanStats } from "@/lib/receipt-scan-validate"
import { receiptCapturePrefillDate } from "@/lib/transaction-dates"
import {
  receiptCameraMode,
  shouldCloseReceiptDialogAfterPickerDismissed,
  type ReceiptCameraMode,
  type ReceiptDialogInitialSource,
} from "@/lib/receipt-camera-capability"
import { ReceiptLiveCamera } from "@/components/receipt-live-camera"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Camera, Upload, Loader2, AlertCircle, X } from "lucide-react"

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"))
    reader.readAsDataURL(file)
  })
}

export function ScanReceiptDialog({
  open,
  onOpenChange,
  initialSource,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, opens dialog and immediately triggers camera or file picker (e.g. from mobile nav one-tap). */
  initialSource?: "camera" | "upload"
}) {
  const { openNewTransaction, openStatementImporter, hasPremiumFeatures } = useApp()
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState("")
  const [preview, setPreview] = useState<string | null>(null)
  const [liveCameraOpen, setLiveCameraOpen] = useState(false)
  // Initialize to "upload-only" (safe SSR default); updated on mount to avoid hydration mismatch.
  const [cameraMode, setCameraMode] = useState<ReceiptCameraMode>("upload-only")
  const showTakePhoto = cameraMode !== "upload-only"

  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      setCameraMode(receiptCameraMode())
    })
    return () => cancelAnimationFrame(rafId)
  }, [])
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** After programmatic file/camera click, next focus/visibility return without a file means picker was dismissed. */
  const expectCloseAfterPickerRef = useRef(false)

  function reset() {
    setScanning(false)
    setError("")
    setPreview(null)
    setLiveCameraOpen(false)
  }

  function handleClose(isOpen: boolean) {
    if (!isOpen) reset()
    onOpenChange(isOpen)
  }

  useEffect(() => {
    if (!open || !initialSource || !hasPremiumFeatures) {
      expectCloseAfterPickerRef.current = false
      return
    }
    const t = setTimeout(() => {
      if (initialSource === "camera") {
        if (cameraMode === "live") setLiveCameraOpen(true)
        else if (cameraMode === "capture-input") cameraInputRef.current?.click()
        else fileInputRef.current?.click()
      } else {
        fileInputRef.current?.click()
      }
      expectCloseAfterPickerRef.current = shouldCloseReceiptDialogAfterPickerDismissed(
        initialSource,
        cameraMode,
      )
    }, 150)
    return () => {
      clearTimeout(t)
    }
  }, [open, initialSource, cameraMode, hasPremiumFeatures])

  function handleTakePhotoClick(mode: ReceiptCameraMode) {
    setError("")
    if (mode === "live") {
      setLiveCameraOpen(true)
      return
    }
    cameraInputRef.current?.click()
  }

  function handleLiveCameraCancel(source: ReceiptDialogInitialSource | undefined) {
    if (source === "camera") {
      handleClose(false)
      return
    }
    setLiveCameraOpen(false)
  }

  useEffect(() => {
    if (!open || !initialSource) return
    const tryCloseAfterPickerDismissed = () => {
      if (!expectCloseAfterPickerRef.current) return
      if (scanning || error) return
      expectCloseAfterPickerRef.current = false
      reset()
      onOpenChange(false)
    }
    window.addEventListener("focus", tryCloseAfterPickerDismissed)
    document.addEventListener("visibilitychange", tryCloseAfterPickerDismissed)
    return () => {
      window.removeEventListener("focus", tryCloseAfterPickerDismissed)
      document.removeEventListener("visibilitychange", tryCloseAfterPickerDismissed)
    }
  }, [open, initialSource, scanning, error, onOpenChange])

  async function processFile(file: File) {
    if (!hasPremiumFeatures) return
    setError("")

    // CSV: attempt client-side statement parse before uploading to server
    if (file.name.toLowerCase().endsWith(".csv")) {
      try {
        const text = await file.text()
        const { tryParseStatementCsv } = await import("@/lib/statement-csv")
        const result = tryParseStatementCsv(text)
        if (!result) {
          setError(
            "This CSV doesn't look like a supported bank statement. To import a BitBudget export, use Import CSV instead."
          )
          return
        }
        onOpenChange(false)
        reset()
        openStatementImporter({ transactions: result.transactions, meta: { institutionName: result.institutionName ?? undefined } })
        return
      } catch {
        setError("Failed to read the CSV file. Please try again.")
        return
      }
    }

    if (file.size > RECEIPT_SCAN_MAX_BYTES) {
      setError(
        `File is too large (max ${Math.round(RECEIPT_SCAN_MAX_BYTES / (1024 * 1024))} MB). Try a smaller photo or PDF.`,
      )
      return
    }
    setScanning(true)

    const canHaveDataUrl =
      file.type.startsWith("image/") || file.type === "application/pdf"
    const dataUrlPromise = canHaveDataUrl
      ? readFileAsDataURL(file).catch(() => undefined)
      : Promise.resolve(undefined)

    if (file.type.startsWith("image/")) {
      void dataUrlPromise.then((url) => {
        if (url) setPreview(url)
      })
    } else {
      setPreview(null)
    }

    try {
      const formData = new FormData()
      formData.append("file", file)

      const res = await fetch("/api/receipts/scan", {
        method: "POST",
        body: formData,
      })

      type ScanResponse =
        | {
            type?: "receipt" | undefined
            error?: string
            message?: string
            payee?: string
            amount?: string
            date?: string
            suggestedEnvelopeId?: string
            extractionConfidence?: number
            model?: string
            processingMs?: number
            inputType?: "photo" | "pdf"
            fileSizeBytes?: number
            envelopeMatchConfidence?: number | null
          }
        | {
            type: "statement"
            transactions: ParsedTransaction[]
            meta: FoldStatementMeta
            format: string
            error?: string
          }

      let data: ScanResponse
      try {
        data = await res.json() as ScanResponse
      } catch {
        setError("Invalid response from server. Please try again.")
        setScanning(false)
        return
      }
      if (!res.ok) {
        const errData = data as { error?: string; message?: string }
        setError(errData.message || errData.error || "Failed to scan receipt")
        setScanning(false)
        return
      }

      // Statement PDF detected — hand off to the statement importer
      if ("type" in data && data.type === "statement") {
        onOpenChange(false)
        reset()
        openStatementImporter({ transactions: data.transactions, meta: data.meta })
        return
      }

      const receiptPreviewDataUrl = (await dataUrlPromise) ?? undefined

      const prefillDate =
        file.type.startsWith("image/")
          ? receiptCapturePrefillDate(data.date || "", file.lastModified)
          : data.date || ""

      const extractionConfidence = typeof data.extractionConfidence === "number"
        ? data.extractionConfidence
        : undefined

      const receiptScanStats: ReceiptScanStats | undefined =
        typeof data.model === "string" && typeof data.processingMs === "number"
          ? {
              model: data.model,
              processingMs: data.processingMs,
              inputType: data.inputType ?? (file.type === "application/pdf" ? "pdf" : "photo"),
              fileSizeBytes: data.fileSizeBytes ?? file.size,
              extractionConfidence: extractionConfidence ?? 0,
              envelopeMatchConfidence: data.envelopeMatchConfidence ?? null,
            }
          : undefined

      onOpenChange(false)
      reset()
      openNewTransaction({
        payee: data.payee || "",
        amount: data.amount || "",
        date: prefillDate,
        ...(data.suggestedEnvelopeId && { envelopeId: data.suggestedEnvelopeId }),
        ...(receiptPreviewDataUrl ? { receiptPreviewDataUrl } : {}),
        ...(extractionConfidence !== undefined ? { receiptScanConfidence: extractionConfidence } : {}),
        ...(receiptScanStats ? { receiptScanStats } : {}),
      })
    } catch {
      setError("Something went wrong. Please try again.")
      setScanning(false)
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      expectCloseAfterPickerRef.current = false
      processFile(file)
    }
    e.target.value = ""
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground max-w-md"
        invisible={!!initialSource && !scanning && !error && !liveCameraOpen}
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">Scan Receipt</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError("")} className="shrink-0 hover:text-red-300">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {scanning ? (
          <div className="flex flex-col items-center gap-4 py-10">
            {preview && (
              <div className="w-full max-h-48 rounded-lg overflow-hidden bg-[#1A1A1A]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="Receipt" className="w-full h-full object-contain max-h-48" />
              </div>
            )}
            <Loader2 className="h-8 w-8 text-btc-orange animate-spin" />
            <p className="text-sm text-muted-foreground">Extracting receipt details...</p>
          </div>
        ) : liveCameraOpen ? (
          <ReceiptLiveCamera
            onCapture={(file) => {
              setLiveCameraOpen(false)
              void processFile(file)
            }}
            onCancel={() => handleLiveCameraCancel(initialSource)}
          />
        ) : (
          <div className="flex flex-col gap-3 py-2">
            {!hasPremiumFeatures ? (
              <div className="rounded-xl border border-[#F7931A]/25 bg-[#F7931A]/10 px-4 py-3 space-y-2">
                <PremiumLockedLabel className="normal-case tracking-normal text-xs" />
                <p className="text-sm text-muted-foreground">{PREMIUM_UI_COPY.receiptScan.dialogHint}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mb-2">
                Scan a receipt to auto-fill a new transaction.
              </p>
            )}

            {showTakePhoto ? (
              <button
                type="button"
                onClick={() => hasPremiumFeatures && handleTakePhotoClick(cameraMode)}
                disabled={!hasPremiumFeatures}
                aria-disabled={!hasPremiumFeatures}
                title={hasPremiumFeatures ? undefined : PREMIUM_UI_COPY.receiptScan.hint}
                className={`flex items-center gap-4 w-full py-4 px-4 rounded-xl text-sm border border-[#333] ${
                  hasPremiumFeatures
                    ? "bg-[#1A1A1A] hover:bg-[#222] transition-colors"
                    : "bg-[#1A1A1A]/60 cursor-not-allowed opacity-80"
                }`}
              >
                <div className="p-2.5 rounded-lg bg-btc-orange/10">
                  <Camera className={`h-5 w-5 ${hasPremiumFeatures ? "text-btc-orange" : "text-muted-foreground"}`} />
                </div>
                <div className="flex flex-col text-left min-w-0 flex-1">
                  <span className={`font-semibold ${hasPremiumFeatures ? "text-foreground" : "text-muted-foreground"}`}>
                    Take Photo
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {hasPremiumFeatures
                      ? cameraMode === "live"
                        ? "Use your webcam to capture a receipt"
                        : "Use your camera to scan a receipt"
                      : PREMIUM_UI_COPY.receiptScan.hint}
                  </span>
                </div>
                {!hasPremiumFeatures ? <PremiumLockedLabel className="shrink-0 normal-case tracking-normal" /> : null}
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => hasPremiumFeatures && fileInputRef.current?.click()}
              disabled={!hasPremiumFeatures}
              aria-disabled={!hasPremiumFeatures}
              title={hasPremiumFeatures ? undefined : PREMIUM_UI_COPY.receiptScan.hint}
              className={`flex items-center gap-4 w-full py-4 px-4 rounded-xl text-sm border border-[#333] ${
                hasPremiumFeatures
                  ? "bg-[#1A1A1A] hover:bg-[#222] transition-colors"
                  : "bg-[#1A1A1A]/60 cursor-not-allowed opacity-80"
              }`}
            >
              <div className="p-2.5 rounded-lg bg-[#8B5CF6]/10">
                <Upload className={`h-5 w-5 ${hasPremiumFeatures ? "text-[#8B5CF6]" : "text-muted-foreground"}`} />
              </div>
              <div className="flex flex-col text-left min-w-0 flex-1">
                <span className={`font-semibold ${hasPremiumFeatures ? "text-foreground" : "text-muted-foreground"}`}>
                  Upload File
                </span>
                <span className="text-xs text-muted-foreground">
                  {hasPremiumFeatures
                    ? "Image, PDF, or bank statement CSV"
                    : PREMIUM_UI_COPY.receiptScan.hint}
                </span>
              </div>
              {!hasPremiumFeatures ? <PremiumLockedLabel className="shrink-0 normal-case tracking-normal" /> : null}
            </button>

            {hasPremiumFeatures && cameraMode === "capture-input" ? (
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileChange}
                className="hidden"
              />
            ) : null}
            {hasPremiumFeatures ? (
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/heic,image/heif,image/webp,application/pdf,.csv"
              onChange={handleFileChange}
              className="hidden"
            />
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
