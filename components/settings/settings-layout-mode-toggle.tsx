"use client"

import { LayoutGrid, Rows3 } from "lucide-react"
import {
  setSettingsLayoutMode,
  type SettingsLayoutMode,
} from "@/lib/settings-layout-mode"
import { cn } from "@/lib/utils"

type Props = {
  mode: SettingsLayoutMode
  onChange: (mode: SettingsLayoutMode) => void
}

const toggleBtnClass =
  "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50"

export function SettingsLayoutModeToggle({ mode, onChange }: Props) {
  function select(next: SettingsLayoutMode) {
    if (next === mode) return
    setSettingsLayoutMode(next)
    onChange(next)
  }

  return (
    <div
      className="flex shrink-0 items-center rounded-xl border border-[#1F1F1F] bg-[#0D0D0D] p-1"
      role="group"
      aria-label="Settings card layout"
    >
      <button
        type="button"
        onClick={() => select("grid")}
        aria-pressed={mode === "grid"}
        className={cn(
          toggleBtnClass,
          mode === "grid"
            ? "bg-[#1A1A1A] text-[#F7931A] border border-[#F7931A]/20"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <LayoutGrid className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="hidden xs:inline">Grid</span>
      </button>
      <button
        type="button"
        onClick={() => select("stack")}
        aria-pressed={mode === "stack"}
        className={cn(
          toggleBtnClass,
          mode === "stack"
            ? "bg-[#1A1A1A] text-[#F7931A] border border-[#F7931A]/20"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Rows3 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="hidden xs:inline">Stack</span>
      </button>
    </div>
  )
}
