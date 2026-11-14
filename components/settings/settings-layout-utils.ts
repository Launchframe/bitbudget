import type { SettingsLayoutMode } from "@/lib/settings-layout-mode"
import { cn } from "@/lib/utils"

/** Outer tab section: responsive grid or single-column stack. */
export function settingsSectionClass(mode: SettingsLayoutMode, gridClasses: string): string {
  return cn(
    "min-w-0 w-full max-w-full gap-6",
    mode === "grid" ? cn("grid", gridClasses) : "flex flex-col",
  )
}

/** Per-card grid placement; ignored in stack mode. */
export function settingsSlotClass(
  mode: SettingsLayoutMode,
  gridClasses: string,
  stackClasses = "min-w-0",
): string {
  return cn(mode === "grid" ? gridClasses : stackClasses)
}

/** Inner nested grid (e.g. Own your data); stack mode uses flex column. */
export function settingsInnerSectionClass(mode: SettingsLayoutMode, gridClasses: string): string {
  return cn("gap-6", mode === "grid" ? cn("grid", gridClasses) : "flex flex-col")
}
