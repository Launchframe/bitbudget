"use client"

import { Fragment, useState, useCallback, useRef, useEffect } from "react"
import { LayoutDashboard, BarChart3, List, Wallet, Plus, Camera, Upload, Mic } from "lucide-react"
import { useApp, type PageId } from "@/lib/app-context"
import { ScanReceiptDialog } from "@/components/scan-receipt-dialog"
import { VoiceDictationButton } from "@/components/voice-dictation-button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

const INPUT_MODE_KEY = "bitbudget-input-mode"
type InputMode = "manual" | "voice" | "camera" | "upload"

const INPUT_MODE_ICONS: Record<InputMode, React.ElementType> = {
  manual: Plus,
  voice: Mic,
  camera: Camera,
  upload: Upload,
}

const INPUT_MODE_LABELS: Record<InputMode, string> = {
  manual: "Manual",
  voice: "Voice",
  camera: "Camera",
  upload: "Upload",
}

/** 2×2 sheet grid: top-left, top-right, bottom-left, bottom-right */
const INPUT_MODE_SHEET_ORDER: InputMode[] = [
  "manual",
  "upload",
  "voice",
  "camera",
]

function loadInputMode(): InputMode {
  if (typeof window === "undefined") return "manual"
  const s = localStorage.getItem(INPUT_MODE_KEY)
  if (s === "voice" || s === "camera" || s === "upload") return s
  return "manual"
}

const navItems: { id: PageId; label: string; icon: React.ElementType }[] = [
  { id: "dashboard", label: "Home", icon: LayoutDashboard },
  { id: "transactions", label: "Txns", icon: List },
  { id: "analytics", label: "Stats", icon: BarChart3 },
  { id: "envelopes", label: "Budget", icon: Wallet },
]

function isVoiceSupported(): boolean {
  if (typeof window === "undefined") return false
  return !!(window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition ||
    !!(window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition
}

export function InputModeButton({
  mode,
  currentMode,
  onClick,
  className,
}: {
  mode: InputMode
  currentMode: InputMode
  onClick: () => void
  className?: string
}) {
  const Icon = INPUT_MODE_ICONS[mode]
  const label = INPUT_MODE_LABELS[mode]
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={currentMode === mode}
      aria-label={`${label} input mode`}
      className={cn(
        "flex aspect-square max-w-[120px] w-full cursor-pointer flex-col items-center justify-center gap-2 self-center rounded-full border border-[#333] bg-[#1A1A1A] transition-colors hover:bg-[#222] focus-visible:bg-[#222] focus:outline-none",
        currentMode === mode
          ? "bg-[#F7931A] text-[#0D0D0D]"
          : "text-[#666] active:text-[#999]",
        className,
      )}
    >
      <Icon className="h-6 w-6 shrink-0 xs:h-8 xs:w-8" />
      <span className="text-xs font-medium xs:text-sm">{label}</span>
    </button>
  )
}

export function MobileNav() {
  const { currentPage, navigateTo, openNewTransaction, inputModeSheetOpen, setInputModeSheetOpen } = useApp()
  const [inputMode, setInputModeState] = useState<InputMode>(loadInputMode)
  const [scanOpen, setScanOpen] = useState(false)
  const [scanInitialSource, setScanInitialSource] = useState<"camera" | "upload" | undefined>(undefined)
  const [voiceSheetOpen, setVoiceSheetOpen] = useState(false)
  const [fabNudge, setFabNudge] = useState(false)
  const fabNudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (fabNudgeTimerRef.current) clearTimeout(fabNudgeTimerRef.current)
    }
  }, [])

  const setInputMode = useCallback((mode: InputMode) => {
    setInputModeState(mode)
    if (typeof window !== "undefined") localStorage.setItem(INPUT_MODE_KEY, mode)
  }, [])

  const runMode = useCallback((mode: InputMode) => {
    switch (mode) {
      case "manual":
        openNewTransaction()
        break
      case "voice":
        setVoiceSheetOpen(true)
        break
      case "camera":
        setScanInitialSource("camera")
        setScanOpen(true)
        break
      case "upload":
        setScanInitialSource("upload")
        setScanOpen(true)
        break
    }
  }, [openNewTransaction])

  const handleScanOpenChange = useCallback((open: boolean) => {
    setScanOpen(open)
    if (!open) setScanInitialSource(undefined)
  }, [])

  const selectMode = useCallback((mode: InputMode) => {
    setInputMode(mode)
    setInputModeSheetOpen(false)
  }, [setInputMode, setInputModeSheetOpen])

  const clearFabNudgeTimer = useCallback(() => {
    if (fabNudgeTimerRef.current) {
      clearTimeout(fabNudgeTimerRef.current)
      fabNudgeTimerRef.current = null
    }
  }, [])

  /** Slide up (CSS transition), stay lifted while picker/sheet loads, then ease back. */
  const handleFabClick = useCallback(() => {
    clearFabNudgeTimer()
    setFabNudge(true)
    runMode(inputMode)
    fabNudgeTimerRef.current = setTimeout(() => {
      setFabNudge(false)
      fabNudgeTimerRef.current = null
    }, 520)
  }, [clearFabNudgeTimer, inputMode, runMode])

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-[#0D0D0D] border-t border-[#1F1F1F] pb-[env(safe-area-inset-bottom)]"
        data-walkthrough="app-nav"
      >
        <div className="flex items-center justify-around px-1 h-16">
          {navItems.map((item, i) => {
            const isActive = currentPage === item.id || (item.id === "envelopes" && (currentPage === "envelope-detail" || currentPage === "envelope-allocations"))
            const Icon = item.icon
            const FabIcon = INPUT_MODE_ICONS[inputMode]

            return (
              <Fragment key={item.id}>
                {i === 2 && (
                  <button
                    type="button"
                    className={cn(
                      "flex h-16 w-16 -mt-6 touch-manipulation items-center justify-center rounded-full bg-[#F7931A] text-[#0D0D0D] shadow-lg shadow-[#F7931A]/20 transition-transform duration-300 ease-out will-change-transform",
                      fabNudge && "-translate-y-3",
                    )}
                    aria-label="New transaction"
                    onClick={handleFabClick}
                  >
                    <FabIcon className="h-6 w-6" />
                  </button>
                )}
                <button
                  onClick={() => navigateTo(item.id)}
                  {...(item.id === "transactions" ? { "data-walkthrough": "transactions-nav" } : {})}
                  className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-1 transition-colors ${
                    isActive ? "text-[#F7931A]" : "text-[#666] active:text-[#999]"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-[10px] font-medium">{item.label}</span>
                </button>
              </Fragment>
            )
          })}
        </div>
      </nav>

      <Sheet open={inputModeSheetOpen} onOpenChange={setInputModeSheetOpen}>
        <SheetContent
          side="bottom"
          className="bottom-0 left-0 right-0 top-auto h-auto max-h-[70vh] rounded-t-2xl border-2 border-b-0 border-[#333] bg-[#0D0D0D] text-foreground"
        >
          <SheetHeader className="border-b-2 border-[#333] pb-4 pr-12 text-left">
            <SheetTitle className="text-foreground">Input mode</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-2 sm:flex sm:flex-row sm:justify-center gap-8 p-12 xs:gap-8 xs:p-8 xs:pt-10">
            {INPUT_MODE_SHEET_ORDER.map((mode, i) => (
              <InputModeButton
                key={mode}
                mode={mode}
                currentMode={inputMode}
                onClick={() => selectMode(mode)}
                className={i % 2 === 0 ? "ml-auto sm:ml-0" : "mr-auto sm:mr-0"}
              />
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <ScanReceiptDialog
        open={scanOpen}
        onOpenChange={handleScanOpenChange}
        initialSource={scanInitialSource}
      />

      <Sheet open={voiceSheetOpen} onOpenChange={setVoiceSheetOpen}>
        <SheetContent side="bottom" className="bg-[#0D0D0D] border-[#1F1F1F] text-foreground">
          <SheetHeader>
            <SheetTitle className="text-foreground">Voice dictation</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">
            {isVoiceSupported() ? (
              <VoiceDictationButton />
            ) : (
              <p className="text-sm text-muted-foreground">
                Voice input is not supported in this browser. Try manual entry or scan receipt instead.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
