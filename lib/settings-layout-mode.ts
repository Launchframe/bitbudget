export type SettingsLayoutMode = "grid" | "stack"

export const SETTINGS_LAYOUT_MODE_KEY = "bitbudget-settings-layout-mode"

const MODE_EVENT = "bitbudget-settings-layout-mode-change"

export function getSettingsLayoutMode(): SettingsLayoutMode {
  if (typeof window === "undefined") return "grid"
  const raw = localStorage.getItem(SETTINGS_LAYOUT_MODE_KEY)
  return raw === "stack" ? "stack" : "grid"
}

export function setSettingsLayoutMode(mode: SettingsLayoutMode): void {
  if (typeof window === "undefined") return
  localStorage.setItem(SETTINGS_LAYOUT_MODE_KEY, mode)
  window.dispatchEvent(new Event(MODE_EVENT))
}

export function subscribeSettingsLayoutMode(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  const handler = () => onChange()
  const storageHandler = (e: StorageEvent) => {
    if (e.key === SETTINGS_LAYOUT_MODE_KEY) onChange()
  }
  window.addEventListener(MODE_EVENT, handler)
  window.addEventListener("storage", storageHandler)
  return () => {
    window.removeEventListener(MODE_EVENT, handler)
    window.removeEventListener("storage", storageHandler)
  }
}
