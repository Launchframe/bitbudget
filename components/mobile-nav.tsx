"use client"

import { Fragment, useState, useCallback } from "react"
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

const INPUT_MODE_KEY = "bitbudget-input-mode"
type InputMode = "manual" | "voice" | "camera" | "upload"

const INPUT_MODE_ICONS: Record<InputMode, React.ElementType> = {
  manual: Plus,
  voice: Mic,
  camera: Camera,
  upload: Upload,
}

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

export function MobileNav() {
  const { currentPage, navigateTo, openNewTransaction, inputModeSheetOpen, setInputModeSheetOpen } = useApp()
  const [inputMode, setInputModeState] = useState<InputMode>(loadInputMode)
  const [scanOpen, setScanOpen] = useState(false)
  const [scanInitialSource, setScanInitialSource] = useState<"camera" | "upload" | undefined>(undefined)
  const [voiceSheetOpen, setVoiceSheetOpen] = useState(false)

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

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-[#0D0D0D] border-t border-[#1F1F1F] pb-[env(safe-area-inset-bottom)]">
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
                    className="flex items-center justify-center w-16 h-16 -mt-6 rounded-full bg-[#F7931A] text-[#0D0D0D] shadow-lg shadow-[#F7931A]/20"
                    aria-label="New transaction"
                    onClick={() => runMode(inputMode)}
                  >
                    <FabIcon className="h-6 w-6" />
                  </button>
                )}
                <button
                  onClick={() => navigateTo(item.id)}
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
          <div className="grid grid-cols-2 gap-8 p-8 pt-10">
            <button
              type="button"
              onClick={() => selectMode("manual")}
              className="flex aspect-square max-w-[160px] w-full cursor-pointer flex-col items-center justify-center gap-2 self-center ml-auto rounded-full border border-[#333] bg-[#1A1A1A] transition-colors hover:bg-[#222] focus-visible:bg-[#222] focus:outline-none"
            >
              <Plus className="h-8 w-8 shrink-0" />
              <span className="text-sm font-medium">Manual</span>
            </button>
            <button
              type="button"
              onClick={() => selectMode("upload")}
              className="flex aspect-square max-w-[160px] w-full cursor-pointer flex-col items-center justify-center gap-2 self-center mr-auto rounded-full border border-[#333] bg-[#1A1A1A] transition-colors hover:bg-[#222] focus-visible:bg-[#222] focus:outline-none"
            >
              <Upload className="h-8 w-8 shrink-0 " />
              <span className="text-sm font-medium">Upload</span>
            </button>
            <button
              type="button"
              onClick={() => selectMode("voice")}
              className="flex aspect-square max-w-[160px] w-full cursor-pointer flex-col items-center justify-center gap-2 self-center ml-auto rounded-full border border-[#333] bg-[#1A1A1A] transition-colors hover:bg-[#222] focus-visible:bg-[#222] focus:outline-none"
            >
              <Mic className="h-8 w-8 shrink-0" />
              <span className="text-sm font-medium">Voice</span>
            </button>
            <button
              type="button"
              onClick={() => selectMode("camera")}
              className="flex aspect-square max-w-[160px] w-full cursor-pointer flex-col items-center justify-center gap-2 self-center mr-auto rounded-full border border-[#333] bg-[#1A1A1A] transition-colors hover:bg-[#222] focus-visible:bg-[#222] focus:outline-none"
            >
              <Camera className="h-8 w-8 shrink-0" />
              <span className="text-sm font-medium">Camera</span>
            </button>
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
