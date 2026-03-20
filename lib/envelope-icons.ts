import {
  Home, Car, ShoppingCart, Utensils, Heart, Plane, BookOpen,
  Gamepad2, Phone, Shield, TrendingUp, PiggyBank, Shirt, ShoppingBag,
  Zap, Baby, Coffee, Dumbbell, Music, Film, Gift, Briefcase, Wrench,
  Dog, Droplets, Wifi, CreditCard, Building2, GraduationCap, Scissors,
  Bus, Landmark, Stethoscope, Bike, Star, Sparkles, Wallet,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { suggestIcon, KEYWORD_RULES } from "./envelope-icon-suggest"

export { suggestIcon }

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
