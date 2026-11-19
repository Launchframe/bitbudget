/**
 * Exact-cent allocation for shared receipts.
 * Parse to integer cents; never accumulate floating-point dollars.
 */

export class ShoppingSplitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ShoppingSplitError"
  }
}

const CENTS_RE = /^-?\d+$/
const DOLLAR_RE = /^-?\d+(?:\.\d{1,2})?$/

export function dollarsToCents(value: unknown): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ShoppingSplitError("Amount is not a number")
    const cents = Math.round(value * 100)
    if (!Number.isSafeInteger(cents)) throw new ShoppingSplitError("Amount is too large")
    return cents
  }
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/[$,]/g, "")
    if (!DOLLAR_RE.test(trimmed)) throw new ShoppingSplitError("Amount is not a valid dollar value")
    const negative = trimmed.startsWith("-")
    const abs = negative ? trimmed.slice(1) : trimmed
    const [whole, frac = ""] = abs.split(".")
    const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2))
    if (!Number.isSafeInteger(cents)) throw new ShoppingSplitError("Amount is too large")
    return negative ? -cents : cents
  }
  throw new ShoppingSplitError("Amount is not a valid dollar value")
}

export function centsToDollars(cents: number): number {
  if (!Number.isInteger(cents)) throw new ShoppingSplitError("Cents must be an integer")
  return cents / 100
}

export function parseQuantityWeight(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ShoppingSplitError("Quantity must be a non-negative number")
  }
  // Fixed 4-decimal quantity weights (e.g. 0.3333 lb).
  const scaled = Math.round(value * 10_000)
  if (scaled < 0) throw new ShoppingSplitError("Quantity must be a non-negative number")
  return scaled
}

export interface SplitShareInput {
  id: string
  weight: number
}

export interface SplitShareResult {
  id: string
  cents: number
}

/**
 * Largest-remainder (Hamilton) method with a stable id tie-break.
 * Weights are already scaled integers (quantity * 10_000).
 */
export function splitCentsByWeights(
  totalCents: number,
  shares: readonly SplitShareInput[],
): SplitShareResult[] {
  if (!Number.isInteger(totalCents)) throw new ShoppingSplitError("Total must be integer cents")
  if (shares.length === 0) {
    if (totalCents === 0) return []
    throw new ShoppingSplitError("Cannot split an amount with no recipients")
  }
  const weightSum = shares.reduce((sum, s) => sum + s.weight, 0)
  if (weightSum <= 0) {
    throw new ShoppingSplitError("Split quantities cannot all be zero")
  }

  const ranked = shares.map((s, index) => ({ ...s, index }))
  const raw = ranked.map((s) => {
    const exact = (totalCents * s.weight) / weightSum
    const floor = Math.trunc(exact)
    return { ...s, floor, remainder: exact - floor }
  })
  let assigned = raw.reduce((sum, r) => sum + r.floor, 0)
  let leftover = totalCents - assigned
  raw.sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder
    return a.id.localeCompare(b.id)
  })
  const bump = leftover > 0 ? 1 : leftover < 0 ? -1 : 0
  leftover = Math.abs(leftover)
  for (let i = 0; i < leftover; i++) {
    raw[i]!.floor += bump
    assigned += bump
  }
  if (raw.reduce((sum, r) => sum + r.floor, 0) !== totalCents) {
    throw new ShoppingSplitError("Split did not conserve cents")
  }
  raw.sort((a, b) => a.index - b.index)
  return raw.map((r) => ({ id: r.id, cents: r.floor }))
}

export interface ReceiptLineAllocationInput {
  lineId: string
  netCents: number
  assignments: Array<{ requestId: string; memberId: string; quantity: number }>
}

export interface ReceiptWideCharges {
  taxCents: number
  discountCents: number
  feeCents: number
}

export interface MemberReceiptTotals {
  memberId: string
  lineCents: number
  taxCents: number
  discountCents: number
  feeCents: number
  totalCents: number
}

/**
 * Split each net line by confirmed received quantities, then spread receipt-wide
 * tax/discount/fee by eligible line value. Every cent of `totalCents` is allocated.
 */
export function allocateReceiptCents(params: {
  lines: readonly ReceiptLineAllocationInput[]
  charges: ReceiptWideCharges
  totalCents: number
  taxableLineIds?: ReadonlySet<string>
}): MemberReceiptTotals[] {
  const { lines, charges, totalCents } = params
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new ShoppingSplitError("Receipt total must be non-negative integer cents")
  }
  for (const [label, cents] of [
    ["tax", charges.taxCents],
    ["discount", charges.discountCents],
    ["fee", charges.feeCents],
  ] as const) {
    if (!Number.isInteger(cents)) throw new ShoppingSplitError(`${label} must be integer cents`)
  }
  if (charges.discountCents < 0 || charges.taxCents < 0 || charges.feeCents < 0) {
    throw new ShoppingSplitError("Tax, discount, and fee must be non-negative")
  }

  const byMember = new Map<string, MemberReceiptTotals>()
  const ensure = (memberId: string): MemberReceiptTotals => {
    let row = byMember.get(memberId)
    if (!row) {
      row = {
        memberId,
        lineCents: 0,
        taxCents: 0,
        discountCents: 0,
        feeCents: 0,
        totalCents: 0,
      }
      byMember.set(memberId, row)
    }
    return row
  }

  const lineMemberCents = new Map<string, SplitShareResult[]>()
  let lineNetSum = 0
  for (const line of lines) {
    if (!Number.isInteger(line.netCents)) {
      throw new ShoppingSplitError("Line amount must be integer cents")
    }
    lineNetSum += line.netCents
    if (line.netCents === 0) {
      lineMemberCents.set(line.lineId, [])
      continue
    }
    if (line.assignments.length === 0) {
      throw new ShoppingSplitError("Every purchased line needs at least one person")
    }
    const weights = line.assignments.map((a) => ({
      id: `${a.requestId}\0${a.memberId}`,
      weight: parseQuantityWeight(a.quantity),
      memberId: a.memberId,
    }))
    const split = splitCentsByWeights(
      line.netCents,
      weights.map((w) => ({ id: w.id, weight: w.weight })),
    )
    lineMemberCents.set(line.lineId, split)
    for (const part of split) {
      const memberId = part.id.split("\0")[1]!
      ensure(memberId).lineCents += part.cents
    }
  }

  const expectedTotal = lineNetSum - charges.discountCents + charges.taxCents + charges.feeCents
  if (expectedTotal !== totalCents) {
    throw new ShoppingSplitError("Line subtotal plus tax and fees must equal the receipt total")
  }

  const eligibleForTax = params.taxableLineIds
    ? lines.filter((l) => params.taxableLineIds!.has(l.lineId))
    : lines
  const taxBase = eligibleForTax.reduce((sum, l) => sum + Math.max(l.netCents, 0), 0)
  const allPositive = lines.reduce((sum, l) => sum + Math.max(l.netCents, 0), 0)

  const spread = (
    chargeCents: number,
    eligibleLines: readonly ReceiptLineAllocationInput[],
    base: number,
    field: "taxCents" | "discountCents" | "feeCents",
  ) => {
    if (chargeCents === 0) return
    if (base <= 0) {
      throw new ShoppingSplitError("Cannot spread charges across zero-value lines")
    }
    const memberWeights: SplitShareInput[] = []
    for (const line of eligibleLines) {
      const parts = lineMemberCents.get(line.lineId) ?? []
      for (const part of parts) {
        if (part.cents <= 0) continue
        const memberId = part.id.split("\0")[1]!
        memberWeights.push({ id: memberId, weight: part.cents })
      }
    }
    const collapsed = new Map<string, number>()
    for (const w of memberWeights) {
      collapsed.set(w.id, (collapsed.get(w.id) ?? 0) + w.weight)
    }
    const split = splitCentsByWeights(
      chargeCents,
      [...collapsed.entries()].map(([id, weight]) => ({ id, weight })),
    )
    for (const part of split) {
      ensure(part.id)[field] += part.cents
    }
  }

  spread(charges.taxCents, eligibleForTax, taxBase, "taxCents")
  spread(charges.discountCents, lines, allPositive, "discountCents")
  spread(charges.feeCents, lines, allPositive, "feeCents")

  const totals = [...byMember.values()].sort((a, b) => a.memberId.localeCompare(b.memberId))
  for (const row of totals) {
    row.totalCents = row.lineCents - row.discountCents + row.taxCents + row.feeCents
  }
  const sum = totals.reduce((s, r) => s + r.totalCents, 0)
  if (sum !== totalCents) {
    throw new ShoppingSplitError("Member shares must equal the receipt total")
  }
  return totals
}

export function assertIntegerCents(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || !CENTS_RE.test(String(value))) {
    throw new ShoppingSplitError(`${label} must be integer cents`)
  }
  return value
}
