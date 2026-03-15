import {
  Home, Car, ShoppingCart, Utensils, Heart, Plane, BookOpen,
  Gamepad2, Phone, Shield, TrendingUp, PiggyBank, Shirt, ShoppingBag,
  Zap, Baby, Coffee, Dumbbell, Music, Film, Gift, Briefcase, Wrench,
  Dog, Droplets, Wifi, CreditCard, Building2, GraduationCap, Scissors,
  Bus, Landmark, Stethoscope, Bike, Star, Sparkles, Wallet,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

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

// Ordered keyword → icon name rules (first match wins)
const KEYWORD_RULES: [RegExp, string][] = [
  [/rent|mortgages|apartments|housing|condos|landlords/i, "Home"],
  [/grocery|groceries|supermarket|whole foods|trader joe|kroger|costco|markets/i, "ShoppingCart"],
  [/restaurants|dining|eat out|eating out|takeout|take-out|pizza|sushi|burritos|doordash|uber eats|grubhub/i, "Utensils"],
  [/food|meals|lunch|dinner|breakfast|snacks/i, "Utensils"],
  [/transport|cars|auto|vehicles|parking|gas stations|fuel|uber|lyft|oil changes|mechanics/i, "Car"],
  [/health|medical|doctor|dentist|pharmacy|prescription|hospitals|clinics|urgent care/i, "Stethoscope"],
  [/insurance|protection|coverage/i, "Shield"],
  [/investments|stocks|crypto|bitcoin|401k|ira|brokerage|etf|portfolio/i, "TrendingUp"],
  [/emergency funds|reserves|rainy days/i, "PiggyBank"],
  [/clothing|clothes|apparel|fashion|shoes|wardrobes|outfits/i, "Shirt"],
  [/travel|vacation|trips|hotel|airbnb|vrbo|flights|cruises/i, "Plane"],
  [/education|school|tuition|college|university|courses|textbooks|learn/i, "GraduationCap"],
  [/books|reading|library/i, "BookOpen"],
  [/phones|mobile|cell phones|wireless|telecom|sprint|verizon|at&t|t-mobile/i, "Phone"],
  [/internet|cable|streaming|wifi|broadband|comcast|xfinity/i, "Wifi"],
  [/entertainment|games|gaming|xbox|playstation|nintendo|steam/i, "Gamepad2"],
  [/music|spotify|concerts|apple music|tidal|bands|festivals|spotify/i, "Music"],
  [/movies|films|netflix|cinemas|hulu|disney\+|disney plus|theaters|hbo|peacock/i, "Film"],
  [/gifts|presents|birthdays|holidays|christmas|donations|charity/i, "Gift"],
  [/business|work|offices|professional|freelance|consulting|llc|sole proprietor/i, "Briefcase"],
  [/repairs|maintenance|handymans|contractors|home improvements|tools/i, "Wrench"],
  [/pet|pet care|dogs|cats|vet|veterinarians|animals/i, "Dog"],
  [/utility|electric|water bills|gas bills|sewage|trash|waste|pg&e/i, "Zap"],
  [/baby|babies|child|children|kids|infants|daycare|childcare|nanny|diapers/i, "Baby"],
  [/coffees|starbucks|latte|cafe|espresso|coffee shops|coffee roasters/i, "Coffee"],
  [/gyms|fitness|workouts|exercise|yoga|pilates|sports/i, "Dumbbell"],
  [/amazon|online shopping|retail|target|walmart|ebay/i, "ShoppingBag"],
  [/loans|debt|credit cards|payment plans|student loans/i, "CreditCard"],
  [/bank|account|transfer|wire/i, "Landmark"],
  [/office|building|condo fees|hoa|coworking/i, "Building2"],
  [/hair|beauty|spa|salon|nails|grooming|barber/i, "Scissors"],
  [/bus|transit|subway|metro|train|commute|public transportation/i, "Bus"],
  [/bike|bicycle|cycling|scooters/i, "Bike"],
  [/water|drinks|hydration/i, "Droplets"],
  [/subscriptions|memberships/i, "CreditCard"],
  [/heart|love|tithes/i, "Heart"],
]

export function suggestIcon(name: string): string {
  const nameLower = name.toLowerCase()
  const nameWords = nameLower.split(/[\s&,]+/).filter(Boolean)

  let bestIcon = "Wallet"
  let bestScore = -1

  for (const [pattern, iconName] of KEYWORD_RULES) {
    const keywords = pattern.source.split("|").map(k => k.replace(/\\/g, "").toLowerCase())

    let ruleScore = 0
    for (const kw of keywords) {
      if (!nameLower.includes(kw)) continue

      const isWholeWord = nameWords.some(w => w === kw)
      const isWordStart = nameWords.some(w => w.startsWith(kw))

      let score: number
      if (isWholeWord) {
        score = 3000 + kw.length
      } else if (kw.includes(" ")) {
        score = 2500 + kw.length
      } else if (kw.length >= 4 && isWordStart) {
        score = 2000 + kw.length
      } else if (kw.length >= 4) {
        score = 1000 + kw.length
      } else {
        continue
      }

      ruleScore = Math.max(ruleScore, score)
    }

    if (ruleScore > bestScore) {
      bestScore = ruleScore
      bestIcon = iconName
    }
  }

  return bestIcon
}

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
