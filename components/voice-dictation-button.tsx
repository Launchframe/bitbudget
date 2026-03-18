"use client"

import { useState, useCallback, useRef } from "react"
import { Mic, MicOff, Loader2 } from "lucide-react"
import { VoiceConfirmationCard } from "@/components/voice-confirmation-card"

interface ParsedVoiceResult {
  payee: string
  amount: number
  envelopeId: string | null
  envelopeName: string | null
  date: string
}

type VoiceState = "idle" | "listening" | "processing" | "result" | "unsupported"

export function VoiceDictationButton() {
  const [voiceState, setVoiceState] = useState<VoiceState>(() => {
    if (typeof window !== "undefined" && !("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      return "unsupported"
    }
    return "idle"
  })
  const [transcript, setTranscript] = useState("")
  const [result, setResult] = useState<ParsedVoiceResult | null>(null)
  const recognitionRef = useRef<ReturnType<typeof createRecognition> | null>(null)
  const lastTranscriptRef = useRef("")

  const startListening = useCallback(() => {
    const recognition = createRecognition()
    if (!recognition) return

    recognitionRef.current = recognition
    lastTranscriptRef.current = ""
    setTranscript("")
    setResult(null)
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
          body: JSON.stringify({ transcript: currentTranscript }),
        })
        if (res.ok) {
          const data = await res.json()
          setResult(data)
          setVoiceState("result")
        } else {
          setVoiceState("idle")
        }
      } catch {
        setVoiceState("idle")
      }
    }

    recognition.onerror = () => {
      setVoiceState("idle")
    }

    recognition.start()
  }, [])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const dismiss = useCallback(() => {
    setVoiceState("idle")
    setResult(null)
    setTranscript("")
  }, [])

  if (voiceState === "unsupported") return null

  return (
    <>
      <button
        onClick={voiceState === "listening" ? stopListening : startListening}
        disabled={voiceState === "processing"}
        title="Voice Input"
        className={`flex items-center justify-center lg:justify-start gap-3 px-2 lg:px-2.5 py-2.5 rounded-xl text-sm transition-colors border ${
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
        <span className="hidden lg:inline">
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

      {voiceState === "result" && result && (
        <VoiceConfirmationCard result={result} onDismiss={dismiss} />
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
