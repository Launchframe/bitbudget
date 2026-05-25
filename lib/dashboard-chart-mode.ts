export type DashboardChartMode = "spending" | "savings"

export const DASHBOARD_CHART_MODE_KEY = "bitbudget-dashboard-mode"

/** One-shot sessionStorage flag: income import success → Dashboard chart uses All range. */
export const DASHBOARD_CHART_RANGE_OVERRIDE_KEY = "dashboard-chart-range-override"

const MODE_EVENT = "bitbudget-dashboard-mode-change"

export function getDashboardChartMode(): DashboardChartMode {
  if (typeof window === "undefined") return "spending"
  const raw = localStorage.getItem(DASHBOARD_CHART_MODE_KEY)
  return raw === "savings" ? "savings" : "spending"
}

export function setDashboardChartMode(mode: DashboardChartMode): void {
  if (typeof window === "undefined") return
  localStorage.setItem(DASHBOARD_CHART_MODE_KEY, mode)
  window.dispatchEvent(new Event(MODE_EVENT))
}

export function subscribeDashboardChartMode(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  const handler = () => onChange()
  const storageHandler = (e: StorageEvent) => {
    if (e.key === DASHBOARD_CHART_MODE_KEY) onChange()
  }
  window.addEventListener(MODE_EVENT, handler)
  window.addEventListener("storage", storageHandler)
  return () => {
    window.removeEventListener(MODE_EVENT, handler)
    window.removeEventListener("storage", storageHandler)
  }
}
