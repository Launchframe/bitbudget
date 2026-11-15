import { prisma } from "@/lib/db"
import {
  candlesToDailyCloseMap,
  neoxaCandlesUrl,
  neoxaTickerUrl,
  parseNeoxaCandlesResponse,
  parseNeoxaTickerLastPrice,
  XBT_MARKET_GENESIS,
} from "@/lib/xbt-price-neoxa"

export { XBT_MARKET_GENESIS, NEOXA_XBT_PAIR } from "@/lib/xbt-price-neoxa"

/**
 * Fetch Neoxa daily candles for BTCB2_USDC, upsert into XbtPriceCache, and
 * return the full cached map plus a spot price (ticker last, else today/latest).
 *
 * Unlike BTC, Neoxa returns the entire listed history in one request (~tens of
 * days today), so there is no multi-chunk CryptoCompare-style backfill.
 */
export async function fetchXbtPriceHistory(
  days: number = 365,
): Promise<{ prices: Record<string, number>; currentPrice: number }> {
  const clampedDays = Math.max(1, Math.min(days, 365))

  const cached = await prisma.xbtPriceCache.findMany({
    orderBy: { date: "asc" },
  })
  const priceMap: Record<string, number> = {}
  for (const p of cached) priceMap[p.date] = p.priceUsd

  const today = new Date().toISOString().split("T")[0]
  const rangeStart = new Date()
  rangeStart.setUTCDate(rangeStart.getUTCDate() - clampedDays)
  const rangeStartStr = rangeStart.toISOString().split("T")[0]
  const cachedInRange = Object.keys(priceMap).filter((d) => d >= rangeStartStr).length

  // Fresh enough if we have most requested days *and* today's row (or market
  // genesis is after the range start and we have everything since genesis).
  const expectedDays = Math.min(
    clampedDays,
    Math.max(
      1,
      Math.ceil(
        (Date.parse(`${today}T00:00:00.000Z`) -
          Date.parse(`${XBT_MARKET_GENESIS}T00:00:00.000Z`)) /
          86_400_000,
      ) + 1,
    ),
  )
  if (cachedInRange >= expectedDays * 0.8 && priceMap[today]) {
    console.log(`[xbt-price] Cache hit: ${cachedInRange}/${expectedDays} days in range`)
    return { prices: priceMap, currentPrice: priceMap[today] }
  }
  console.log(
    `[xbt-price] Cache miss: ${cachedInRange}/${expectedDays} days, fetching Neoxa candles…`,
  )

  try {
    const url = neoxaCandlesUrl(undefined, { interval: "1d", limit: 1000 })
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.error(`[xbt-price] Neoxa candles ${res.status}: ${body.slice(0, 200)}`)
      throw new Error(`Neoxa candles ${res.status}`)
    }
    const json = await res.json()
    const candles = parseNeoxaCandlesResponse(json)
    console.log(`[xbt-price] Neoxa returned ${candles.length} daily candles`)

    if (candles.length > 0) {
      const dayPrices = candlesToDailyCloseMap(candles)
      await cachePrices(dayPrices)
      Object.assign(priceMap, dayPrices)
    }
  } catch (err) {
    console.error(`[xbt-price] Neoxa candles fetch failed:`, err)
  }

  let currentPrice = priceMap[today] ?? 0
  if (!currentPrice) {
    currentPrice = (await getCurrentXbtPrice()) || cached[cached.length - 1]?.priceUsd || 0
  } else {
    // Prefer live ticker when we already have a candle for today.
    const live = await fetchNeoxaTickerPrice()
    if (live) {
      currentPrice = live
      await cachePrices({ [today]: live })
      priceMap[today] = live
    }
  }

  return { prices: priceMap, currentPrice }
}

async function fetchNeoxaTickerPrice(): Promise<number | null> {
  try {
    const res = await fetch(neoxaTickerUrl(), { next: { revalidate: 300 } })
    if (!res.ok) return null
    return parseNeoxaTickerLastPrice(await res.json())
  } catch {
    return null
  }
}

async function cachePrices(dayPrices: Record<string, number>) {
  const entries = Object.entries(dayPrices)
  const BATCH = 50
  for (let b = 0; b < entries.length; b += BATCH) {
    const batch = entries.slice(b, b + BATCH)
    await Promise.all(
      batch.map(([date, priceUsd]) =>
        prisma.xbtPriceCache.upsert({
          where: { date },
          update: { priceUsd, fetchedAt: new Date() },
          create: { date, priceUsd },
        }),
      ),
    )
  }
}

/** Prefer DB when today’s row is fresh; only then hit Neoxa (mirrors BTC). */
const TICKER_CACHE_TTL_MS = 5 * 60 * 1000

export async function getCurrentXbtPrice(): Promise<number> {
  const today = new Date().toISOString().split("T")[0]

  const cached = await prisma.xbtPriceCache.findUnique({ where: { date: today } })
  if (
    cached &&
    Date.now() - new Date(cached.fetchedAt).getTime() < TICKER_CACHE_TTL_MS
  ) {
    return cached.priceUsd
  }

  const live = await fetchNeoxaTickerPrice()
  if (live) {
    await prisma.xbtPriceCache.upsert({
      where: { date: today },
      update: { priceUsd: live, fetchedAt: new Date() },
      create: { date: today, priceUsd: live },
    })
    return live
  }

  if (cached) return cached.priceUsd

  const latest = await prisma.xbtPriceCache.findFirst({ orderBy: { date: "desc" } })
  return latest?.priceUsd ?? 0
}

/**
 * Look up the cached XBT price for a specific date (YYYY-MM-DD).
 * Falls back to the nearest earlier cached close.
 *
 * Aligns with client `priceOnDateFromHistory({ allowBeforeFirst: false })`:
 * dates before the first cached candle return null (never invent a mark from
 * today's spot, and never substitute BTC). Spot is allowed only for **today
 * UTC** when the cache still has no row for that day (cold start).
 */
export async function getXbtPriceForDate(date: string): Promise<number | null> {
  const exact = await prisma.xbtPriceCache.findUnique({ where: { date } })
  if (exact) return exact.priceUsd

  const nearest = await prisma.xbtPriceCache.findFirst({
    where: { date: { lte: date } },
    orderBy: { date: "desc" },
  })
  if (nearest) return nearest.priceUsd

  const todayUtc = new Date().toISOString().slice(0, 10)
  if (date === todayUtc) {
    const current = await getCurrentXbtPrice()
    return current > 0 ? current : null
  }

  return null
}

/** Opportunity-cost math is identical for XBT and BTC; amount / priceAt * current. */
export function calculateXbtOpportunityCost(
  amount: number,
  priceAtPurchase: number,
  currentPrice: number,
): number {
  if (!(priceAtPurchase > 0) || !(currentPrice > 0)) return 0
  return (amount / priceAtPurchase) * currentPrice
}

const SATS_PER_XBT = 100_000_000

export function xbtSatsPerDollar(xbtPriceUsd: number): number {
  if (!(xbtPriceUsd > 0)) return 0
  return Math.round(SATS_PER_XBT / xbtPriceUsd)
}

export function usdToXbtSats(usd: number, xbtPriceUsd: number): number {
  if (!(xbtPriceUsd > 0)) return 0
  return Math.round((usd / xbtPriceUsd) * SATS_PER_XBT)
}
