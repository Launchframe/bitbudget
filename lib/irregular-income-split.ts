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

type SplitRow = { id: string; ideal: number; floor: number; cur: number }

/** Max-heap of indices into `rows`; top = largest (ideal - cur), then lexicographic id for stability. */
function siftDown(rows: SplitRow[], heap: number[], i: number): void {
  const n = heap.length
  for (let idx = i; ; ) {
    const l = idx * 2 + 1
    const r = l + 1
    let m = idx
    const hi = heap[idx]!
    if (l < n && better(rows, heap[l]!, hi)) m = l
    if (r < n && better(rows, heap[r]!, heap[m]!)) m = r
    if (m === idx) return
    heap[idx] = heap[m]!
    heap[m] = hi
    idx = m
  }
}

function better(rows: SplitRow[], ia: number, ib: number): boolean {
  const a = rows[ia]!
  const b = rows[ib]!
  const sa = a.ideal - a.cur
  const sb = b.ideal - b.cur
  if (sa !== sb) return sa > sb
  return a.id.localeCompare(b.id) < 0
}

function popMax(rows: SplitRow[], heap: number[]): number | undefined {
  if (heap.length === 0) return undefined
  const top = heap[0]!
  const last = heap.pop()!
  if (heap.length > 0) {
    heap[0] = last
    siftDown(rows, heap, 0)
  }
  return top
}

function pushMax(rows: SplitRow[], heap: number[], idx: number): void {
  heap.push(idx)
  let i = heap.length - 1
  while (i > 0) {
    const p = Math.floor((i - 1) / 2)
    if (!better(rows, heap[i]!, heap[p]!)) return
    const tmp = heap[i]!
    heap[i] = heap[p]!
    heap[p] = tmp
    i = p
  }
}

/**
 * Split gross amount `X` across envelopes proportional to allotments vs `monthlyIncome`.
 * Integer cents + greedily assigning spare to the most under-funded row vs ideal share (max-heap, O(spare log n)).
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

  const rows: SplitRow[] = []
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
    rows.push({ id: e.id, ideal, floor, cur: floor })
  }

  if (rows.length === 0) {
    return { envelopeIdToCents }
  }

  let spare = grossCents - floorSum
  if (spare < 0) {
    return { envelopeIdToCents: new Map() }
  }

  const heap: number[] = []
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.ideal - rows[i]!.cur > 0) pushMax(rows, heap, i)
  }

  while (spare > 0) {
    const i = popMax(rows, heap)
    if (i === undefined) break
    const row = rows[i]!
    if (row.ideal - row.cur <= 0) continue
    row.cur++
    spare--
    if (row.ideal - row.cur > 0) pushMax(rows, heap, i)
  }

  for (const r of rows) {
    envelopeIdToCents.set(r.id, r.cur)
  }

  return { envelopeIdToCents }
}

/** Sum envelope cents from split result. */
export function sumAllocatedIrregularCents(result: IrregularSplitResult): number {
  let s = 0
  for (const v of result.envelopeIdToCents.values()) s += v
  return s
}
