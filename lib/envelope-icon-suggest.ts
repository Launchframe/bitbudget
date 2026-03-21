/**
 * Server-safe icon suggestion: keyword rules and suggestIcon only.
 * No lucide-react or icon components — use from API routes and server code.
 * For UI, use pickEnvelopeIconForName / EnvelopeIconDisplay from lib/envelope-icons.
 */

// Keyword → icon name rules; suggestIcon() picks the best match by score. Exported for envelope-icons SUGGESTION_SEARCH_INDEX.
export const KEYWORD_RULES: [RegExp, string][] = [
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

export function suggestIconWithMatch(name: string): { icon: string; matched: boolean; score: number } {
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

  return { icon: bestIcon, matched: bestScore > -1, score: bestScore }
}

export function suggestIcon(name: string): string {
  return suggestIconWithMatch(name).icon
}
