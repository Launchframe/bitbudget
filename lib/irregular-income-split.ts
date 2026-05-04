/**
 * Pure helpers for irregular-income proportional splits (same mix as scheduled funding vs declared income).
 */

export interface IrregularSplitEnvelopeInput {
  id: string
  monthlyAllotment: number
}

export interface IrregularSplitResult {
  /** Cents allocated to each envelope id (positive integers when monthlyIncome > 0). */
  envelopeIdToCents: Map<string, number>
}

/**
 * Split gross amount `X` across envelopes proportional to allotments vs `monthlyIncome`.
 * Uses integer cents + greedy largest-remainder steps so Σ allocations equals gross when possible.
 */
export function computeIrregularIncomeSplits(params: {
  grossUsd: number
  monthlyIncome: number
  envelopes: readonly IrregularSplitEnvelopeInput[]
  /** Exclude Savings system envelope ids */
  excludeEnvelopeIds?: ReadonlySet<string>
}): IrregularSplitResult {
  const exclude = params.excludeEnvelopeIds ?? new Set<string>()
  const grossCents = Math.round(params.grossUsd * 100)
  const monthlyIncome = params.monthlyIncome

  const envelopeIdToCents = new Map<string, number>()

  if (!Number.isFinite(grossCents) || grossCents <= 0) {
    return { envelopeIdToCents }
  }

  if (!Number.isFinite(monthlyIncome) || monthlyIncome <= 0) {
    return { envelopeIdToCents }
  }

  const miCents = Math.round(monthlyIncome * 100)
  if (miCents <= 0) {
    return { envelopeIdToCents }
  }

  type Row = { id: string; ideal: number; floor: number }
  const rows: Row[] = []
  let floorSum = 0

  for (const e of params.envelopes) {
    if (exclude.has(e.id)) continue
    const allot = e.monthlyAllotment
    if (!Number.isFinite(allot) || allot <= 0) continue
    const allotCents = Math.round(allot * 100)
    if (allotCents <= 0) continue

    const ideal = (grossCents * allotCents) / miCents
    const floor = Math.floor(ideal)
    floorSum += floor
    rows.push({ id: e.id, ideal, floor })
  }

  if (rows.length === 0) {
    return { envelopeIdToCents }
  }

  for (const r of rows) {
    envelopeIdToCents.set(r.id, r.floor)
  }

  let spare = grossCents - floorSum
  if (spare < 0) {
    // Over-allocated floors (extreme float) — zero out
    return { envelopeIdToCents: new Map() }
  }

  while (spare > 0) {
    let bestId: string | null = null
    let bestScore = -Infinity
    for (const r of rows) {
      const cur = envelopeIdToCents.get(r.id) ?? 0
      const score = r.ideal - cur
      if (score > bestScore) {
        bestScore = score
        bestId = r.id
      }
    }
    if (!bestId || bestScore <= 0) break
    envelopeIdToCents.set(bestId, (envelopeIdToCents.get(bestId) ?? 0) + 1)
    spare--
  }

  return { envelopeIdToCents }
}

/** Sum envelope cents from split result. */
export function sumAllocatedIrregularCents(result: IrregularSplitResult): number {
  let s = 0
  for (const v of result.envelopeIdToCents.values()) s += v
  return s
}
