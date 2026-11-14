/**
 * Pure parsers for Neoxa Exchange public market data used as BitBudget's XBT
 * (Bitcoin Blake2B / BTCB2) USD price source.
 *
 * Endpoints (no auth):
 * - GET /api/exchange/candles/BTCB2_USDC?interval=1d&limit=…
 * - GET /api/exchange/ticker/BTCB2_USDC
 *
 * These helpers do not fetch or touch Prisma — safe for Vitest and client use.
 */

export const NEOXA_XBT_PAIR = "BTCB2_USDC" as const
export const NEOXA_EXCHANGE_BASE = "https://neoxa.exchange"

/** Earliest daily candle observed on Neoxa for BTCB2_USDC (UTC). */
export const XBT_MARKET_GENESIS = "2026-09-01"

export interface NeoxaCandle {
  /** Unix seconds (UTC midnight for interval=1d). */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface NeoxaCandlesPayload {
  success: true
  pair: string
  interval: string
  candles: NeoxaCandle[]
}

function isFinitePositiveNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0
}

function isFiniteNonNegativeNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0
}

function parseCandle(raw: unknown): NeoxaCandle | null {
  if (!raw || typeof raw !== "object") return null
  const c = raw as Record<string, unknown>
  if (
    typeof c.time !== "number" ||
    !Number.isFinite(c.time) ||
    c.time <= 0 ||
    !isFinitePositiveNumber(c.open) ||
    !isFinitePositiveNumber(c.high) ||
    !isFinitePositiveNumber(c.low) ||
    !isFinitePositiveNumber(c.close) ||
    !isFiniteNonNegativeNumber(c.volume)
  ) {
    return null
  }
  return {
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }
}

/**
 * Validate a Neoxa candles JSON body and return the candle list.
 * Throws if `success` is false or the shape is unusable.
 */
export function parseNeoxaCandlesResponse(json: unknown): NeoxaCandle[] {
  if (!json || typeof json !== "object") {
    throw new Error("Neoxa candles: empty response")
  }
  const body = json as Record<string, unknown>
  if (body.success !== true) {
    const message =
      typeof body.message === "string" ? body.message : "success != true"
    throw new Error(`Neoxa candles: ${message}`)
  }
  if (!Array.isArray(body.candles)) {
    throw new Error("Neoxa candles: missing candles array")
  }
  const out: NeoxaCandle[] = []
  for (const row of body.candles) {
    const candle = parseCandle(row)
    if (candle) out.push(candle)
  }
  return out
}

/** UTC calendar day (YYYY-MM-DD) for a Neoxa candle `time` (unix seconds). */
export function candleUtcDate(timeUnixSec: number): string {
  return new Date(timeUnixSec * 1000).toISOString().slice(0, 10)
}

/**
 * Collapse candles to one USD close per UTC day.
 * Later candles for the same day overwrite earlier ones (Neoxa daily bars are
 * already one per day; this stays correct if we ever ingest 1h bars).
 */
export function candlesToDailyCloseMap(
  candles: NeoxaCandle[],
): Record<string, number> {
  const map: Record<string, number> = {}
  const sorted = [...candles].sort((a, b) => a.time - b.time)
  for (const c of sorted) {
    if (c.close <= 0) continue
    map[candleUtcDate(c.time)] = c.close
  }
  return map
}

/**
 * Extract last traded price from a Neoxa ticker payload.
 * Returns null when the body is malformed or the price is unusable.
 */
export function parseNeoxaTickerLastPrice(json: unknown): number | null {
  if (!json || typeof json !== "object") return null
  const body = json as Record<string, unknown>
  if (body.success !== true) return null
  const ticker = body.ticker
  if (!ticker || typeof ticker !== "object") return null
  const last = (ticker as Record<string, unknown>).lastPrice
  return isFinitePositiveNumber(last) ? last : null
}

export function neoxaCandlesUrl(
  pair: string = NEOXA_XBT_PAIR,
  opts: { interval?: string; limit?: number } = {},
): string {
  const interval = opts.interval ?? "1d"
  const limit = opts.limit ?? 500
  const params = new URLSearchParams({
    interval,
    limit: String(limit),
  })
  return `${NEOXA_EXCHANGE_BASE}/api/exchange/candles/${pair}?${params}`
}

export function neoxaTickerUrl(pair: string = NEOXA_XBT_PAIR): string {
  return `${NEOXA_EXCHANGE_BASE}/api/exchange/ticker/${pair}`
}
