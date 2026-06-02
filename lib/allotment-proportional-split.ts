/**
 * Split a USD pool across envelopes by positive monthly allotment (2-decimal, sums exactly).
 */

export interface EnvelopeAllotmentRow {
  id: string
  monthlyAllotment: number
}

export function splitUsdProportionalByAllotment(
  poolUsd: number,
  envelopes: readonly EnvelopeAllotmentRow[],
): Map<string, number> {
  const out = new Map<string, number>()
  const pool = Math.round(Math.max(0, poolUsd) * 100) / 100
  if (pool <= 0) return out

  const eligible = envelopes.filter((e) => Number.isFinite(e.monthlyAllotment) && e.monthlyAllotment > 0)
  const totalAllot = eligible.reduce((s, e) => s + e.monthlyAllotment, 0)
  if (totalAllot <= 0) return out

  let remainingPool = pool
  for (let i = 0; i < eligible.length; i++) {
    const env = eligible[i]!
    const share =
      i === eligible.length - 1
        ? remainingPool
        : Math.round(((pool * env.monthlyAllotment) / totalAllot) * 100) / 100
    remainingPool = Math.round((remainingPool - share) * 100) / 100
    if (share > 0.005) out.set(env.id, share)
  }
  return out
}
