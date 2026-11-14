import type { CSSProperties } from "react"
import type { LucideIcon } from "lucide-react"
import {
  BookOpen,
  MessageSquare,
  PiggyBank,
  Plug,
  Settings2,
  Shield,
} from "lucide-react"
import { SAVINGS_GOLD_ACCENT } from "@/lib/constants"

export type SettingsTab =
  | "general"
  | "communications"
  | "savings"
  | "integrations"
  | "payees"
  | "data"

export const SETTINGS_TAB_SLUGS: Record<SettingsTab, string> = {
  general: "general",
  communications: "communications",
  savings: "savings-tracking",
  integrations: "integrations",
  payees: "budgeting-rules",
  data: "data-security",
}

export const SETTINGS_TAB_FROM_SLUG: Record<string, SettingsTab> = {
  general: "general",
  communications: "communications",
  savings: "savings",
  "savings-tracking": "savings",
  integrations: "integrations",
  tags: "payees",
  payees: "payees",
  "payee-mappings": "payees",
  "budgeting-rules": "payees",
  data: "data",
  "data-security": "data",
}

export function settingsTabFromLocationHash(): SettingsTab | null {
  if (typeof window === "undefined") return null
  const path = window.location.hash.replace(/^#\/?/, "")
  const slug = path.startsWith("settings/") ? path.slice("settings/".length) : null
  if (!slug) return null
  const tab = SETTINGS_TAB_FROM_SLUG[slug]
  if (!tab) return null
  if (slug === "tags") {
    const hash = `#/settings/${SETTINGS_TAB_SLUGS.payees}`
    if (window.location.hash !== hash) {
      window.history.replaceState({ page: "settings", settingsTab: "payees" }, "", hash)
    }
  }
  return tab
}

export type SettingsNavItem = {
  id: SettingsTab
  label: string
  icon: LucideIcon
  savingsAccent?: boolean
}

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "communications", label: "Communications", icon: MessageSquare },
  { id: "savings", label: "Savings tracking", icon: PiggyBank, savingsAccent: true },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "payees", label: "Budgeting rules", icon: BookOpen },
  { id: "data", label: "Data & Security", icon: Shield },
]

export function settingsTabIconClass(active: boolean, savingsAccent?: boolean): string {
  if (active && savingsAccent) return "h-3.5 w-3.5 shrink-0"
  return `h-3.5 w-3.5 shrink-0 ${active ? "text-btc-orange" : "text-muted-foreground"}`
}

export function settingsTabIconStyle(
  active: boolean,
  savingsAccent?: boolean,
): CSSProperties | undefined {
  if (active && savingsAccent) return { color: SAVINGS_GOLD_ACCENT }
  return undefined
}

export function settingsTabButtonClass(active: boolean, savingsAccent?: boolean): string {
  const base =
    "flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left text-sm font-medium transition-colors"
  if (active && savingsAccent) {
    return `${base} bg-[#1A1A1A] border`
  }
  return `${base} ${
    active
      ? "bg-[#1A1A1A] text-[#F7931A] border border-[#F7931A]/20"
      : "text-muted-foreground hover:text-foreground hover:bg-[#111111]"
  }`
}

export function settingsTabButtonStyle(
  active: boolean,
  savingsAccent?: boolean,
): CSSProperties | undefined {
  if (active && savingsAccent) {
    return { color: SAVINGS_GOLD_ACCENT, borderColor: `${SAVINGS_GOLD_ACCENT}40` }
  }
  return undefined
}
