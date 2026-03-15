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
  [/rent|mortgage|apartment|housing|condo|landlord/i, "Home"],
  [/grocery|groceries|supermarket|whole foods|trader joe|kroger|costco|market/i, "ShoppingCart"],
  [/restaurant|dining|eat out|takeout|take-out|pizza|sushi|burrito|doordash|uber eats|grubhub/i, "Utensils"],
  [/food|meal|lunch|dinner|breakfast|snack/i, "Utensils"],
  [/car|auto|vehicle|parking|gas station|fuel|uber|lyft|oil change/i, "Car"],
  [/health|medical|doctor|dentist|pharmacy|prescription|hospital|clinic|urgent care/i, "Stethoscope"],
  [/insurance|protect|coverage/i, "Shield"],
  [/invest|stock|crypto|bitcoin|401k|ira|brokerage|etf|portfolio/i, "TrendingUp"],
  [/savings|emergency fund|reserve|rainy day/i, "PiggyBank"],
  [/clothing|clothes|apparel|fashion|shoes|wardrobe|outfit/i, "Shirt"],
  [/travel|vacation|trip|hotel|airbnb|vrbo|flight|cruise/i, "Plane"],
  [/education|school|tuition|college|university|course|textbook|learn/i, "GraduationCap"],
  [/book|reading|library/i, "BookOpen"],
  [/phone|mobile|cell|wireless|telecom|sprint|verizon|at&t|t-mobile/i, "Phone"],
  [/internet|cable|streaming|wifi|broadband|comcast|xfinity/i, "Wifi"],
  [/entertainment|games|gaming|xbox|playstation|nintendo|steam/i, "Gamepad2"],
  [/music|spotify|concert|apple music|tidal/i, "Music"],
  [/movie|film|netflix|cinema|hulu|disney|theater|hbo/i, "Film"],
  [/gift|present|birthday|holiday|christmas|donation|charity/i, "Gift"],
  [/business|work|office|professional|freelance|consulting/i, "Briefcase"],
  [/repair|maintenance|handyman|contractor|home improvement|tool/i, "Wrench"],
  [/pet|dog|cat|vet|veterinarian|animal/i, "Dog"],
  [/utility|electric|water bill|gas bill|sewage|trash|waste|pg&e/i, "Zap"],
  [/baby|child|kid|infant|daycare|childcare|nanny|diaper/i, "Baby"],
  [/coffee|starbucks|latte|cafe/i, "Coffee"],
  [/gym|fitness|workout|exercise|yoga|pilates|sport/i, "Dumbbell"],
  [/shopping|amazon|online shopping|retail|target|walmart|ebay/i, "ShoppingBag"],
  [/loan|debt|credit card|payment plan|student loan/i, "CreditCard"],
  [/bank|account|transfer|wire/i, "Landmark"],
  [/office|building|condo fee|hoa|coworking/i, "Building2"],
  [/hair|beauty|spa|salon|nail|grooming|barber/i, "Scissors"],
  [/bus|transit|subway|metro|train|commute|public transport/i, "Bus"],
  [/bike|bicycle|cycling|scooter/i, "Bike"],
  [/water|drinks|hydra/i, "Droplets"],
  [/subscri|membership/i, "CreditCard"],
  [/heart|love|tithe/i, "Heart"],
]

export function suggestIcon(name: string): string {
  for (const [pattern, iconName] of KEYWORD_RULES) {
    if (pattern.test(name)) return iconName
  }
  return "Wallet"
}

export function getEnvelopeIcon(iconName: string | null | undefined): LucideIcon {
  if (iconName && ENVELOPE_ICONS[iconName]) return ENVELOPE_ICONS[iconName]
  return Wallet
}
