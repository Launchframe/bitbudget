"use client"

import { useState, useRef, useEffect } from "react"
import { useApp } from "@/lib/app-context"
import { RECEIPT_SCAN_MAX_BYTES } from "@/lib/receipt-scan-validate"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Camera, Upload, Loader2, AlertCircle, X } from "lucide-react"

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
  const { openNewTransaction } = useApp()
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState("")
  const [preview, setPreview] = useState<string | null>(null)
  const [suppressChoiceUI, setSuppressChoiceUI] = useState(false)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** After programmatic file/camera click, next focus/visibility return without a file means picker was dismissed. */
  const expectCloseAfterPickerRef = useRef(false)

  useEffect(() => {
    if (!open || !initialSource) {
      expectCloseAfterPickerRef.current = false
      return
    }
    // When an initial source is provided, hide the choice UI and open the picker.
    // Defer setState to satisfy react-hooks/set-state-in-effect (avoid sync setState in effect).
    const hideId = setTimeout(() => setSuppressChoiceUI(true), 0)
    const t = setTimeout(() => {
      if (initialSource === "camera") cameraInputRef.current?.click()
      else fileInputRef.current?.click()
      expectCloseAfterPickerRef.current = true
    }, 150)
    return () => {
      clearTimeout(hideId)
      clearTimeout(t)
    }
  }, [open, initialSource])

  useEffect(() => {
    if (!open || !initialSource) return
    const tryCloseAfterPickerDismissed = () => {
      if (!expectCloseAfterPickerRef.current) return
      if (scanning || error) return
      expectCloseAfterPickerRef.current = false
      setSuppressChoiceUI(false)
      onOpenChange(false)
    }
    window.addEventListener("focus", tryCloseAfterPickerDismissed)
    document.addEventListener("visibilitychange", tryCloseAfterPickerDismissed)
    return () => {
      window.removeEventListener("focus", tryCloseAfterPickerDismissed)
      document.removeEventListener("visibilitychange", tryCloseAfterPickerDismissed)
    }
  }, [open, initialSource, scanning, error, onOpenChange])

  function reset() {
    setScanning(false)
    setError("")
    setPreview(null)
    setSuppressChoiceUI(false)
  }

  function handleClose(open: boolean) {
    if (!open) reset()
    onOpenChange(open)
  }

  async function processFile(file: File) {
    setError("")
    if (file.size > RECEIPT_SCAN_MAX_BYTES) {
      setError(
        `File is too large (max ${Math.round(RECEIPT_SCAN_MAX_BYTES / (1024 * 1024))} MB). Try a smaller photo or PDF.`,
      )
      return
    }
    setScanning(true)

    if (file.type.startsWith("image/")) {
      const reader = new FileReader()
      reader.onload = () => setPreview(reader.result as string)
      reader.readAsDataURL(file)
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

      let data: {
        error?: string
        payee?: string
        amount?: string
        date?: string
        suggestedEnvelopeId?: string
      }
      try {
        data = await res.json()
      } catch {
        setError("Invalid response from server. Please try again.")
        setScanning(false)
        return
      }
      if (!res.ok) {
        setError(data.error || "Failed to scan receipt")
        setScanning(false)
        return
      }

      onOpenChange(false)
      reset()
      openNewTransaction({
        payee: data.payee || "",
        amount: data.amount || "",
        date: data.date || "",
        ...(data.suggestedEnvelopeId && { envelopeId: data.suggestedEnvelopeId }),
      })
    } catch {
      setError("Something went wrong. Please try again.")
      setScanning(false)
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ""
  }

  const skipChoiceUI = !!initialSource && suppressChoiceUI && !scanning && !error

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground max-w-md"
        invisible={skipChoiceUI}
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
            <Loader2 className="h-8 w-8 text-[#F7931A] animate-spin" />
            <p className="text-sm text-muted-foreground">Extracting receipt details...</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 py-2">
            <p className="text-sm text-muted-foreground mb-2">
              Scan a receipt to auto-fill a new transaction.
            </p>

            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="flex items-center gap-4 w-full py-4 px-4 bg-[#1A1A1A] rounded-xl text-sm hover:bg-[#222] transition-colors border border-[#333]"
            >
              <div className="p-2.5 rounded-lg bg-[#F7931A]/10">
                <Camera className="h-5 w-5 text-[#F7931A]" />
              </div>
              <div className="flex flex-col text-left">
                <span className="font-semibold text-foreground">Take Photo</span>
                <span className="text-xs text-muted-foreground">Use your camera to scan a receipt</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-4 w-full py-4 px-4 bg-[#1A1A1A] rounded-xl text-sm hover:bg-[#222] transition-colors border border-[#333]"
            >
              <div className="p-2.5 rounded-lg bg-[#8B5CF6]/10">
                <Upload className="h-5 w-5 text-[#8B5CF6]" />
              </div>
              <div className="flex flex-col text-left">
                <span className="font-semibold text-foreground">Upload File</span>
                <span className="text-xs text-muted-foreground">Image or PDF from your device</span>
              </div>
            </button>

            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/heic,image/heif,image/webp,application/pdf"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
