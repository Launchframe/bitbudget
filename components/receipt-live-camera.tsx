"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Camera, Loader2, X, Zap, ZapOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  analyzeVideoFrame,
  getAutoCapureHint,
  ANALYSIS_W,
  ANALYSIS_H,
  ANALYSIS_INTERVAL_MS,
  HOLD_DURATION_MS,
  type FrameScore,
} from "@/lib/receipt-auto-capture"

// ─── Guide rect in SVG viewBox="0 0 400 300" (4:3) ───────────────────────────
const GX = 68
const GY = 22
const GW = 264
const GH = 256
/** Corner bracket arm length (SVG units). */
const CS = 22

interface ReceiptLiveCameraProps {
  onCapture: (file: File) => void
  onCancel: () => void
}

export function ReceiptLiveCamera({ onCapture, onCancel }: ReceiptLiveCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const mountedRef = useRef(false)
  const capturingRef = useRef(false)

  // ── Auto-capture state ───────────────────────────────────────────────────────
  const [autoMode, setAutoModeState] = useState(true)
  const autoModeRef = useRef(true)

  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const prevGrayRef = useRef<Uint8Array | null>(null)
  const lastAnalysisTimeRef = useRef<number>(0)
  const holdStartRef = useRef<number | null>(null)
  const rafRef = useRef<number>(0)

  const [countdownProgress, setCountdownProgress] = useState(0)
  const [frameScore, setFrameScore] = useState<FrameScore | null>(null)
  const [flashOpacity, setFlashOpacity] = useState(0)

  // ── Camera start/stop ────────────────────────────────────────────────────────
  const [starting, setStarting] = useState(true)
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cameraReady, setCameraReady] = useState(false)

  const stopActiveStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    let cancelled = false
    mountedRef.current = true

    // Create the persistent off-screen analysis canvas once.
    if (!analysisCanvasRef.current) {
      const c = document.createElement("canvas")
      c.width = ANALYSIS_W
      c.height = ANALYSIS_H
      analysisCanvasRef.current = c
    }

    async function startCamera() {
      setStarting(true)
      setError(null)
      let stream: MediaStream | null = null
      try {
        if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
          throw new Error("Camera access is not available in this browser.")
        }
        stream = await navigator.mediaDevices.getUserMedia({
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
        setCameraReady(true)
      } catch {
        stream?.getTracks().forEach((track) => track.stop())
        if (streamRef.current === stream) streamRef.current = null
        if (!cancelled) {
          setError(
            "We couldn't access your camera. Check browser permissions, or upload a photo instead.",
          )
          setStarting(false)
        }
      }
    }

    void startCamera()

    return () => {
      cancelled = true
      mountedRef.current = false
      capturingRef.current = false
      cancelAnimationFrame(rafRef.current)
      stopActiveStream()
    }
  }, [stopActiveStream])

  // ── rAF analysis loop ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!cameraReady) return
    cancelAnimationFrame(rafRef.current)

    function loop(timestamp: number) {
      if (!mountedRef.current) return

      const video = videoRef.current
      const canvas = analysisCanvasRef.current

      if (autoModeRef.current && video && canvas) {
        // Pixel analysis: throttled to ANALYSIS_INTERVAL_MS
        if (timestamp - lastAnalysisTimeRef.current >= ANALYSIS_INTERVAL_MS) {
          lastAnalysisTimeRef.current = timestamp
          const { score, gray } = analyzeVideoFrame(
            video,
            canvas,
            prevGrayRef.current,
          )
          prevGrayRef.current = gray
          setFrameScore(score)

          if (score.ready) {
            if (holdStartRef.current === null) holdStartRef.current = timestamp
          } else {
            holdStartRef.current = null
          }
        }

        // Countdown progress: smooth every frame
        if (holdStartRef.current !== null) {
          const held = timestamp - holdStartRef.current
          const progress = Math.min(1, held / HOLD_DURATION_MS)
          setCountdownProgress(progress)

          if (progress >= 1 && !capturingRef.current) {
            // Trigger auto-capture
            holdStartRef.current = null
            setCountdownProgress(0)
            setFlashOpacity(1)
            setTimeout(() => {
              if (mountedRef.current) setFlashOpacity(0)
            }, 80)
            setTimeout(() => {
              if (mountedRef.current) doCapture()
            }, 120)
          }
        } else {
          setCountdownProgress(0)
        }
      }

      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraReady])

  // ── Mode toggle ───────────────────────────────────────────────────────────────
  function setAutoMode(val: boolean) {
    autoModeRef.current = val
    setAutoModeState(val)
    if (!val) {
      holdStartRef.current = null
      prevGrayRef.current = null
      setCountdownProgress(0)
      setFrameScore(null)
    }
  }

  // ── Capture ───────────────────────────────────────────────────────────────────
  function doCapture() {
    const video = videoRef.current
    if (!video || video.videoWidth === 0 || capturingRef.current) return

    capturingRef.current = true
    setCapturing(true)
    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext("2d")
    if (!ctx) {
      capturingRef.current = false
      setCapturing(false)
      return
    }
    ctx.drawImage(video, 0, 0)

    canvas.toBlob(
      (blob) => {
        if (!mountedRef.current || !capturingRef.current) return
        if (!blob) {
          capturingRef.current = false
          setCapturing(false)
          return
        }
        stopActiveStream()
        onCapture(new File([blob], `receipt-${Date.now()}.jpg`, { type: "image/jpeg" }))
      },
      "image/jpeg",
      0.92,
    )
  }

  function handleManualCapture() {
    if (autoMode) {
      // In auto mode the button acts as an immediate override.
      holdStartRef.current = null
      setCountdownProgress(0)
    }
    doCapture()
  }

  // ── Derived UI state ──────────────────────────────────────────────────────────
  const isHolding = countdownProgress > 0
  const cornerColor = isHolding ? "#22C55E" : "rgba(255,255,255,0.55)"
  const hintText = autoMode
    ? isHolding
      ? "Hold still…"
      : getAutoCapureHint(frameScore)
    : "Position the receipt in view, then capture."

  return (
    <div className="flex flex-col gap-3 py-2">
      {/* Camera viewport */}
      <div className="relative aspect-4/3 w-full overflow-hidden rounded-xl border border-[#333] bg-[#1A1A1A]">
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-full w-full object-cover"
          aria-label="Camera preview"
        />

        {/* Guide overlay */}
        {!starting && !error && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 400 300"
            preserveAspectRatio="none"
            aria-hidden
          >
            {/* Dim fill outside guide rect */}
            <mask id="guide-mask">
              <rect width="400" height="300" fill="white" />
              <rect x={GX} y={GY} width={GW} height={GH} fill="black" rx="2" />
            </mask>
            <rect
              width="400"
              height="300"
              fill="rgba(0,0,0,0.35)"
              mask="url(#guide-mask)"
            />

            {/* Guide rect border */}
            <rect
              x={GX}
              y={GY}
              width={GW}
              height={GH}
              fill="none"
              stroke={isHolding ? "#22C55E" : "rgba(255,255,255,0.18)"}
              strokeWidth={isHolding ? 1.5 : 1}
              strokeDasharray={isHolding ? undefined : "6 5"}
              rx="2"
            />

            {/* Corner brackets — top-left */}
            <path
              d={`M ${GX} ${GY + CS} L ${GX} ${GY} L ${GX + CS} ${GY}`}
              fill="none"
              stroke={cornerColor}
              strokeWidth="3"
              strokeLinecap="round"
            />
            {/* top-right */}
            <path
              d={`M ${GX + GW - CS} ${GY} L ${GX + GW} ${GY} L ${GX + GW} ${GY + CS}`}
              fill="none"
              stroke={cornerColor}
              strokeWidth="3"
              strokeLinecap="round"
            />
            {/* bottom-left */}
            <path
              d={`M ${GX} ${GY + GH - CS} L ${GX} ${GY + GH} L ${GX + CS} ${GY + GH}`}
              fill="none"
              stroke={cornerColor}
              strokeWidth="3"
              strokeLinecap="round"
            />
            {/* bottom-right */}
            <path
              d={`M ${GX + GW - CS} ${GY + GH} L ${GX + GW} ${GY + GH} L ${GX + GW} ${GY + GH - CS}`}
              fill="none"
              stroke={cornerColor}
              strokeWidth="3"
              strokeLinecap="round"
            />

            {/* Countdown progress bar — inside bottom edge of guide rect */}
            {isHolding && (
              <>
                {/* track */}
                <rect
                  x={GX + 2}
                  y={GY + GH - 6}
                  width={GW - 4}
                  height={4}
                  fill="rgba(34,197,94,0.2)"
                  rx="2"
                />
                {/* fill */}
                <rect
                  x={GX + 2}
                  y={GY + GH - 6}
                  width={Math.max(0, (GW - 4) * countdownProgress)}
                  height={4}
                  fill="#22C55E"
                  rx="2"
                />
              </>
            )}
          </svg>
        )}

        {/* Auto / Manual mode pill — top-right corner */}
        {!starting && !error && (
          <button
            type="button"
            onClick={() => setAutoMode(!autoMode)}
            className={`absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              autoMode
                ? "bg-btc-orange text-[#0D0D0D]"
                : "bg-black/60 text-white/80 hover:bg-black/80"
            }`}
            aria-pressed={autoMode}
            aria-label={autoMode ? "Auto-capture on — tap to switch to manual" : "Manual mode — tap to enable auto-capture"}
          >
            {autoMode ? (
              <Zap className="h-2.5 w-2.5" aria-hidden />
            ) : (
              <ZapOff className="h-2.5 w-2.5" aria-hidden />
            )}
            {autoMode ? "Auto" : "Manual"}
          </button>
        )}

        {/* Camera starting spinner */}
        {starting && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0D0D0D]/80">
            <Loader2 className="h-8 w-8 animate-spin text-btc-orange" aria-hidden />
            <p className="text-sm text-muted-foreground">Starting camera…</p>
          </div>
        )}

        {/* Shutter flash */}
        <div
          className="pointer-events-none absolute inset-0 bg-white transition-opacity duration-300"
          style={{ opacity: flashOpacity }}
          aria-hidden
        />
      </div>

      {/* Status / hint */}
      {error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : (
        <p
          className={`text-sm transition-colors ${
            isHolding ? "text-success" : "text-muted-foreground"
          }`}
          aria-live="polite"
          aria-atomic
        >
          {hintText}
        </p>
      )}

      {/* Controls */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          className={`flex-1 transition-colors ${
            autoMode
              ? "border border-[#333] bg-transparent text-muted-foreground hover:bg-[#1A1A1A] hover:text-foreground"
              : "bg-btc-orange text-[#0D0D0D] hover:bg-btc-orange/90"
          }`}
          variant={autoMode ? "outline" : "default"}
          disabled={starting || !!error || capturing}
          onClick={handleManualCapture}
        >
          <Camera className="h-4 w-4" aria-hidden />
          {autoMode ? "Capture now" : "Capture photo"}
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
