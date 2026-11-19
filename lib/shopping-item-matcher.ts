/**
 * Local matching of receipt lines to shopping requests.
 * Deterministic token similarity only — no remote matching service.
 */

export interface ShoppingMatchRequest {
  id: string
  memberId: string
  description: string
  requestedQuantity: number
  purchasedQuantity: number
  unit: string
}

export interface ShoppingMatchLine {
  id: string
  description: string
  quantity: number
  unit: string
}

export interface ShoppingMatchCandidate {
  requestId: string
  score: number
  reason: "exact" | "token"
}

const ABBREVIATIONS: Record<string, string> = {
  lb: "pound",
  lbs: "pound",
  oz: "ounce",
  pkg: "pack",
  pk: "pack",
  ea: "each",
  ct: "count",
  gal: "gallon",
  qt: "quart",
  pt: "pint",
  bg: "bag",
  bn: "bunch",
  dz: "dozen",
  org: "organic",
}

const COUNT_UNITS = new Set(["each", "count", "pack", "bag", "bunch", "dozen", ""])
const WEIGHT_UNITS = new Set(["pound", "ounce", "gram", "kilogram"])
const VOLUME_UNITS = new Set(["gallon", "quart", "pint", "liter", "milliliter"])

export function normalizeShoppingToken(raw: string): string {
  const lower = raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  if (!lower) return ""
  return ABBREVIATIONS[lower] ?? lower
}

export function tokenizeShoppingName(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(normalizeShoppingToken)
    .filter((t) => t.length > 1 || /^\d/.test(t))
}

export function normalizeUnit(unit: string): string {
  return normalizeShoppingToken(unit.trim().toLowerCase())
}

export type UnitFamily = "count" | "weight" | "volume" | "other"

export function unitFamily(unit: string): UnitFamily {
  const n = normalizeUnit(unit)
  if (COUNT_UNITS.has(n)) return "count"
  if (WEIGHT_UNITS.has(n)) return "weight"
  if (VOLUME_UNITS.has(n)) return "volume"
  return "other"
}

export function unitsCompatible(a: string, b: string): boolean {
  const fa = unitFamily(a)
  const fb = unitFamily(b)
  if (fa === "other" || fb === "other") return fa === fb && normalizeUnit(a) === normalizeUnit(b)
  return fa === fb
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const sa = new Set(a)
  const sb = new Set(b)
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter += 1
  return inter / (sa.size + sb.size - inter)
}

export function scoreRequestAgainstLine(
  request: ShoppingMatchRequest,
  line: ShoppingMatchLine,
): ShoppingMatchCandidate | null {
  if (!unitsCompatible(request.unit, line.unit)) return null
  const remaining = request.requestedQuantity - request.purchasedQuantity
  if (remaining <= 0) return null
  const reqTokens = tokenizeShoppingName(request.description)
  const lineTokens = tokenizeShoppingName(line.description)
  const reqJoined = reqTokens.join(" ")
  const lineJoined = lineTokens.join(" ")
  if (reqJoined && reqJoined === lineJoined) {
    return { requestId: request.id, score: 1, reason: "exact" }
  }
  const score = jaccard(reqTokens, lineTokens)
  if (score < 0.34) return null
  return { requestId: request.id, score, reason: "token" }
}

export function suggestMatchesForLine(
  line: ShoppingMatchLine,
  requests: readonly ShoppingMatchRequest[],
): ShoppingMatchCandidate[] {
  const hits: ShoppingMatchCandidate[] = []
  for (const request of requests) {
    const hit = scoreRequestAgainstLine(request, line)
    if (hit) hits.push(hit)
  }
  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.requestId.localeCompare(b.requestId)
  })
  return hits
}

/**
 * Allocate line quantity across matched requests without double-counting.
 * `touchedRequestIds` are never overwritten by a later pass.
 */
export function allocateLineQuantities(params: {
  lineQuantity: number
  rankedRequestIds: readonly string[]
  remainingByRequest: ReadonlyMap<string, number>
  touchedRequestIds?: ReadonlySet<string>
}): Map<string, number> {
  const out = new Map<string, number>()
  let leftover = params.lineQuantity
  for (const id of params.rankedRequestIds) {
    if (leftover <= 0) break
    if (params.touchedRequestIds?.has(id)) continue
    const remaining = params.remainingByRequest.get(id) ?? 0
    if (remaining <= 0) continue
    const take = Math.min(remaining, leftover)
    out.set(id, take)
    leftover -= take
  }
  return out
}
