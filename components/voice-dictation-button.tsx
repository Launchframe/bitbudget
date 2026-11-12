"use client"

import { useState, useCallback, useRef } from "react"
import { Mic, MicOff, Loader2 } from "lucide-react"
import { PremiumLockedLabel } from "@/components/premium-locked-label"
import { PREMIUM_UI_COPY } from "@/lib/premium-ui-copy"
import { useApp } from "@/lib/app-context"
import { todayTransactionCalendarDay } from "@/lib/transaction-dates"

type VoiceState = "idle" | "listening" | "processing" | "unsupported"

interface VoiceDictationButtonProps {
  locked?: boolean
  /** Called after a successful parse opens the New Transaction dialog (e.g. close a sheet). */
  onOpenedTransaction?: () => void
}

export function VoiceDictationButton({
  locked = false,
  onOpenedTransaction,
}: VoiceDictationButtonProps) {
  const { openNewTransaction } = useApp()
  const [voiceState, setVoiceState] = useState<VoiceState>(() => {
    if (typeof window !== "undefined" && !("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      return "unsupported"
    }
    return "idle"
  })
  const [transcript, setTranscript] = useState("")
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<ReturnType<typeof createRecognition> | null>(null)
  const lastTranscriptRef = useRef("")

  const startListening = useCallback(() => {
    const recognition = createRecognition()
    if (!recognition) return

    recognitionRef.current = recognition
    lastTranscriptRef.current = ""
    setTranscript("")
    setError(null)
    setVoiceState("listening")

    recognition.onresult = (event: { results: { transcript: string }[][] }) => {
      const results = event.results
      const last = results[results.length - 1]?.[0]?.transcript ?? ""
      lastTranscriptRef.current = last
      setTranscript(last)
    }

    recognition.onend = async () => {
      setVoiceState("processing")
      const currentTranscript = lastTranscriptRef.current
      if (!currentTranscript) {
        setVoiceState("idle")
        return
      }

      try {
        const res = await fetch("/api/voice/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: currentTranscript,
            today: todayTransactionCalendarDay(),
          }),
        })
        if (!res.ok) {
          setError("Could not parse that. Try again.")
          setVoiceState("idle")
          return
        }
        const data = (await res.json()) as {
          payee?: string
          amount?: number
          date?: string
        }

        const amount =
          typeof data.amount === "number" && Number.isFinite(data.amount) && data.amount > 0
            ? String(data.amount)
            : undefined

        // Open the same New Transaction form as manual entry so payee canonical
        // matching and auto-enveloping apply. Omit envelopeId so the dialog can
        // fill from payee history (passing LLM envelopeId would skip that path).
        openNewTransaction({
          ...(data.payee?.trim() ? { payee: data.payee.trim() } : {}),
          ...(amount ? { amount } : {}),
          ...(data.date ? { date: data.date } : {}),
        })
        setVoiceState("idle")
        setTranscript("")
        onOpenedTransaction?.()
      } catch {
        setError("Something went wrong. Try again.")
        setVoiceState("idle")
      }
    }

    recognition.onerror = () => {
      setVoiceState("idle")
    }

    recognition.start()
  }, [onOpenedTransaction, openNewTransaction])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  if (voiceState === "unsupported") return null

  if (locked && voiceState === "idle") {
    return (
      <button
        type="button"
        disabled
        aria-disabled
        aria-label="Voice Input"
        title={PREMIUM_UI_COPY.voiceEntry.hint}
        className="flex items-center justify-center lg:justify-start gap-3 px-2 lg:px-4 py-2.5 rounded-xl text-sm transition-colors border bg-[#1A1A1A]/60 border-[#333] text-muted-foreground cursor-not-allowed opacity-80 w-full"
      >
        <Mic className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="hidden lg:inline ml-1">Voice Input</span>
        <PremiumLockedLabel className="hidden lg:inline ml-auto normal-case tracking-normal" />
      </button>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={voiceState === "listening" ? stopListening : startListening}
        disabled={voiceState === "processing"}
        title="Voice Input"
        aria-label="Voice Input"
        className={`flex items-center justify-center lg:justify-start gap-3 px-2 lg:px-4 py-2.5 rounded-xl text-sm transition-colors border w-full ${
          voiceState === "listening"
            ? "bg-red-500/20 border-red-500/50 text-red-400 animate-pulse"
            : voiceState === "processing"
              ? "bg-[#1A1A1A] border-[#333] text-muted-foreground"
              : "bg-[#1A1A1A] border-[#333] text-foreground hover:bg-[#222]"
        }`}
      >
        {voiceState === "processing" ? (
          <Loader2 className="h-4 w-4 text-[#F7931A] shrink-0 animate-spin" />
        ) : voiceState === "listening" ? (
          <MicOff className="h-4 w-4 shrink-0" />
        ) : (
          <Mic className="h-4 w-4 text-[#F7931A] shrink-0" />
        )}
        <span className="hidden lg:inline ml-1">
          {voiceState === "listening"
            ? "Stop"
            : voiceState === "processing"
              ? "Parsing..."
              : "Voice Input"}
        </span>
      </button>

      {voiceState === "listening" && transcript && (
        <div className="mt-2 px-3 py-2 bg-[#1A1A1A] rounded-xl text-xs text-muted-foreground italic">
          &ldquo;{transcript}&rdquo;
        </div>
      )}

      {error && voiceState === "idle" && (
        <div className="mt-2 px-3 py-2 bg-[#1A1A1A] rounded-xl text-xs text-red-400">
          {error}
        </div>
      )}
    </>
  )
}

function createRecognition(): {
  start: () => void
  stop: () => void
  onresult: ((e: { results: { transcript: string }[][] }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
} | null {
  const SpeechRecognition =
    (window as unknown as { SpeechRecognition?: new () => unknown }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition
  if (!SpeechRecognition) return null
  const recognition = new SpeechRecognition() as {
    continuous: boolean
    interimResults: boolean
    lang: string
    start: () => void
    stop: () => void
    onresult: ((e: { results: { transcript: string }[][] }) => void) | null
    onend: (() => void) | null
    onerror: (() => void) | null
  }
  recognition.continuous = false
  recognition.interimResults = true
  recognition.lang = "en-US"
  return recognition
}
