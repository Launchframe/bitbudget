"use client"

import { useEffect, useRef, useState } from "react"
import { Camera, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"

interface ReceiptLiveCameraProps {
  onCapture: (file: File) => void
  onCancel: () => void
}

export function ReceiptLiveCamera({ onCapture, onCancel }: ReceiptLiveCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [starting, setStarting] = useState(true)
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function startCamera() {
      setStarting(true)
      setError(null)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play()
        }
        setStarting(false)
      } catch {
        if (!cancelled) {
          setError(
            "We couldn’t access your camera. Check browser permissions, or upload a photo instead.",
          )
          setStarting(false)
        }
      }
    }

    void startCamera()

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  function handleCapture() {
    const video = videoRef.current
    if (!video || video.videoWidth === 0 || capturing) return

    setCapturing(true)
    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext("2d")
    if (!ctx) {
      setCapturing(false)
      return
    }
    ctx.drawImage(video, 0, 0)

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCapturing(false)
          return
        }
        streamRef.current?.getTracks().forEach((track) => track.stop())
        onCapture(new File([blob], `receipt-${Date.now()}.jpg`, { type: "image/jpeg" }))
      },
      "image/jpeg",
      0.92,
    )
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-[#333] bg-[#1A1A1A]">
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-full w-full object-cover"
          aria-label="Camera preview"
        />
        {starting ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0D0D0D]/80">
            <Loader2 className="h-8 w-8 animate-spin text-btc-orange" aria-hidden />
            <p className="text-sm text-muted-foreground">Starting camera…</p>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Position the receipt in view, then capture.
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          className="flex-1 bg-btc-orange text-[#0D0D0D] hover:bg-btc-orange/90"
          disabled={starting || !!error || capturing}
          onClick={handleCapture}
        >
          <Camera className="h-4 w-4" aria-hidden />
          Capture photo
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1 border-[#333] bg-transparent"
          onClick={onCancel}
        >
          <X className="h-4 w-4" aria-hidden />
          Cancel
        </Button>
      </div>
    </div>
  )
}
