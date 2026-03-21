import {
  Home, Car, ShoppingCart, Utensils, Heart, Plane, BookOpen,
  Gamepad2, Phone, Shield, TrendingUp, PiggyBank, Shirt, ShoppingBag,
  Zap, Baby, Coffee, Dumbbell, Music, Film, Gift, Briefcase, Wrench,
  Dog, Droplets, Wifi, CreditCard, Building2, GraduationCap, Scissors,
  Bus, Landmark, Stethoscope, Bike, Star, Sparkles, Wallet,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { suggestIcon, suggestIconWithMatch, KEYWORD_RULES } from "./envelope-icon-suggest"

export { suggestIcon }

/** Persisted `icon` value for bold letter placeholder (not a Lucide name). */
export const LETTERS_ENVELOPE_ICON_PREFIX = "__bb_letters__:"

export function isLettersEnvelopeIcon(icon: string | null | undefined): boolean {
  return typeof icon === "string" && icon.startsWith(LETTERS_ENVELOPE_ICON_PREFIX)
}

export function getLettersEnvelopeIconText(icon: string | null | undefined): string {
  if (!isLettersEnvelopeIcon(icon)) return ""
  return icon.slice(LETTERS_ENVELOPE_ICON_PREFIX.length)
}

/** Build persisted icon field for initial-letter display (A–Z / 0–9 only, max 4 chars). */
export function makeLettersEnvelopeIcon(letters: string): string {
  const cleaned = letters.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4)
  return LETTERS_ENVELOPE_ICON_PREFIX + (cleaned || "?")
}

/** Two-letter (or single-letter) abbreviation from envelope name for placeholder icons. */
export function initialsForEnvelopeName(name: string): string {
  const t = name.trim()
  if (!t) return "?"
  const parts = t
    .split(/\s+/)
    .filter(Boolean)
    .map(p => p.replace(/[^a-zA-Z0-9]/g, ""))
    .filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length >= 2) {
    const a = parts[0]!
    const b = parts[parts.length - 1]!
    return (a[0]! + b[0]!).toUpperCase()
  }
  const w = parts[0]!
  if (w.length >= 2) return w.slice(0, 2).toUpperCase()
  return w[0]!.toUpperCase()
}

function uniqueLettersEnvelopeIcon(name: string, used: Set<string>): string {
  const compact = name.replace(/[^a-zA-Z0-9]+/g, "").toUpperCase()
  const initials = initialsForEnvelopeName(name).replace(/[^A-Z0-9]/g, "")

  const attempts: string[] = []
  if (initials.length >= 2) attempts.push(initials.slice(0, 2))
  else if (initials.length === 1) attempts.push(initials)
  for (let len = 3; len <= 5; len++) {
    if (compact.length >= len) attempts.push(compact.slice(0, len))
  }

  const seenAttempts = new Set<string>()
  for (const raw of attempts) {
    if (!raw || seenAttempts.has(raw)) continue
    seenAttempts.add(raw)
    const key = makeLettersEnvelopeIcon(raw)
    if (!used.has(key)) return key
  }

  const base = (initials.slice(0, 2) || initials || "X").replace(/[^A-Z0-9]/g, "") || "X"
  for (let i = 2; i < 100; i++) {
    const key = makeLettersEnvelopeIcon(base + String(i))
    if (!used.has(key)) return key
  }
  return makeLettersEnvelopeIcon("?")
}

/**
 * Lucide icon name when a keyword rule matched confidently and that icon is unused; otherwise a unique letters placeholder.
 */
const MIN_CONFIDENT_ICON_SCORE = 2000

export function pickEnvelopeIconForName(
  name: string,
  usedIcons: Iterable<string | null | undefined>,
): string {
  const used = new Set(
    Array.from(usedIcons).filter((x): x is string => typeof x === "string" && x.length > 0),
  )
  const { icon: suggested, matched, score } = suggestIconWithMatch(name)
  if (matched && score >= MIN_CONFIDENT_ICON_SCORE && !used.has(suggested)) return suggested
  return uniqueLettersEnvelopeIcon(name, used)
}

export const ENVELOPE_ICON_LIST: { name: string; Icon: LucideIcon }[] = [
  { name: "Home", Icon: Home },
  { name: "Car", Icon: Car },
  { name: "ShoppingCart", Icon: ShoppingCart },
  { name: "Utensils", Icon: Utensils },
  { name: "Heart", Icon: Heart },
  { name: "Plane", Icon: Plane },
  { name: "BookOpen", Icon: BookOpen },
  { name: "Gamepad2", Icon: Gamepad2 },
  { name: "Phone", Icon: Phone },
  { name: "Shield", Icon: Shield },
  { name: "TrendingUp", Icon: TrendingUp },
  { name: "PiggyBank", Icon: PiggyBank },
  { name: "Shirt", Icon: Shirt },
  { name: "ShoppingBag", Icon: ShoppingBag },
  { name: "Zap", Icon: Zap },
  { name: "Baby", Icon: Baby },
  { name: "Coffee", Icon: Coffee },
  { name: "Dumbbell", Icon: Dumbbell },
  { name: "Music", Icon: Music },
  { name: "Film", Icon: Film },
  { name: "Gift", Icon: Gift },
  { name: "Briefcase", Icon: Briefcase },
  { name: "Wrench", Icon: Wrench },
  { name: "Dog", Icon: Dog },
  { name: "Droplets", Icon: Droplets },
  { name: "Wifi", Icon: Wifi },
  { name: "CreditCard", Icon: CreditCard },
  { name: "Building2", Icon: Building2 },
  { name: "GraduationCap", Icon: GraduationCap },
  { name: "Scissors", Icon: Scissors },
  { name: "Bus", Icon: Bus },
  { name: "Landmark", Icon: Landmark },
  { name: "Stethoscope", Icon: Stethoscope },
  { name: "Bike", Icon: Bike },
  { name: "Wallet", Icon: Wallet },
  { name: "Sparkles", Icon: Sparkles },
  { name: "Star", Icon: Star },
]

export const ENVELOPE_ICONS: Record<string, LucideIcon> = Object.fromEntries(
  ENVELOPE_ICON_LIST.map(({ name, Icon }) => [name, Icon]),
)

export function getEnvelopeIcon(iconName: string | null | undefined): LucideIcon {
  if (iconName && isLettersEnvelopeIcon(iconName)) return Wallet
  if (iconName && ENVELOPE_ICONS[iconName]) return ENVELOPE_ICONS[iconName]
  return Wallet
}

export const ENVELOPE_SUGGESTIONS = [
  "Rent", "Groceries", "Transportation", "Dining Out", "Utilities",
  "Insurance", "Investments", "Entertainment", "Subscriptions",
  "Clothing", "Health & Medical", "Phone", "Internet", "Education",
  "Travel", "Gifts & Donations", "Personal Care", "Pet Care", "Fitness",
  "Coffee", "Shopping", "Baby & Kids", "Home Repair", "Business",
  "Loan Payments", "Music", "Movies", "Books", "Gas & Fuel",
]

const SUGGESTION_SEARCH_INDEX: Map<string, string> = (() => {
  const iconToKeywords = new Map<string, string[]>()
  for (const [pattern, iconName] of KEYWORD_RULES) {
    const words = pattern.source.split("|").map(w => w.replace(/\\/g, ""))
    const existing = iconToKeywords.get(iconName) || []
    iconToKeywords.set(iconName, [...existing, ...words])
  }

  const index = new Map<string, string>()
  for (const name of ENVELOPE_SUGGESTIONS) {
    const icon = suggestIcon(name)
    const keywords = iconToKeywords.get(icon) || []
    index.set(name, [name, ...keywords].join(" ").toLowerCase())
  }
  return index
})()

export function filterSuggestions(
  query: string,
  excludeNames: Set<string>,
): string[] {
  const q = query.trim().toLowerCase()
  return ENVELOPE_SUGGESTIONS.filter(name => {
    if (excludeNames.has(name.toLowerCase())) return false
    if (q === "") return true
    const haystack = SUGGESTION_SEARCH_INDEX.get(name) || name.toLowerCase()
    return haystack.includes(q)
  })
}
