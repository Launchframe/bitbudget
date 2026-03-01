import { prisma } from "@/lib/db"

const COINGECKO_BASE = "https://api.coingecko.com/api/v3"
const CRYPTOCOMPARE_BASE = "https://min-api.cryptocompare.com/data/v2"
const BTC_PRICE_GENESIS = "2010-07-17"

/**
 * Fetch the most recent 365 days of BTC/USD prices from CoinGecko.
 * Used for the initial page load — CoinGecko's free tier caps at 365 days.
 */
export async function fetchBtcPriceHistory(
  days: number = 365,
): Promise<{ prices: Record<string, number>; currentPrice: number }> {
  const clampedDays = Math.min(days, 365)

  const cached = await prisma.btcPriceCache.findMany({
    orderBy: { date: "asc" },
  })
  const priceMap: Record<string, number> = {}
  for (const p of cached) priceMap[p.date] = p.priceUsd

  const today = new Date().toISOString().split("T")[0]

  const rangeStart = new Date()
  rangeStart.setDate(rangeStart.getDate() - clampedDays)
  const rangeStartStr = rangeStart.toISOString().split("T")[0]
  const cachedInRange = Object.keys(priceMap).filter(d => d >= rangeStartStr).length

  if (cachedInRange >= clampedDays * 0.8 && priceMap[today]) {
    console.log(`[btc-price] Cache hit: ${cachedInRange}/${clampedDays} days in range`)
    return { prices: priceMap, currentPrice: priceMap[today] }
  }
  console.log(`[btc-price] Cache miss: ${cachedInRange}/${clampedDays} days, fetching from CoinGecko...`)

  try {
    const url = `${COINGECKO_BASE}/coins/bitcoin/market_chart?vs_currency=usd&days=${clampedDays}&precision=2`
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.error(`[btc-price] CoinGecko returned ${res.status}: ${body.slice(0, 200)}`)
      throw new Error(`CoinGecko ${res.status}`)
    }

    const data = await res.json()
    const rawPrices: [number, number][] = data.prices ?? []
    console.log(`[btc-price] CoinGecko returned ${rawPrices.length} data points`)

    if (rawPrices.length > 0) {
      const dayPrices: Record<string, number> = {}
      for (const [ts, price] of rawPrices) {
        dayPrices[new Date(ts).toISOString().split("T")[0]] = price
      }

      const latestPrice = rawPrices[rawPrices.length - 1][1]

      await cachePrices(dayPrices)
      Object.assign(priceMap, dayPrices)

      return { prices: priceMap, currentPrice: latestPrice }
    }
  } catch (err) {
    console.error(`[btc-price] CoinGecko fetch failed:`, err)
  }

  const fallbackPrice = cached[cached.length - 1]?.priceUsd ?? 0
  return { prices: priceMap, currentPrice: priceMap[today] ?? fallbackPrice }
}

/**
 * Background backfill: fetches up to 2000 days of older data from CryptoCompare.
 * Call repeatedly until status is "complete" (typically 3 calls covers all BTC history).
 * Returns the newly fetched prices so the client can merge them.
 */
export async function backfillBtcPrices(): Promise<{
  status: "in_progress" | "complete"
  earliestDate: string
  newPrices: Record<string, number>
}> {
  const earliest = await prisma.btcPriceCache.findFirst({
    orderBy: { date: "asc" },
  })

  if (!earliest) {
    return { status: "in_progress", earliestDate: new Date().toISOString().split("T")[0], newPrices: {} }
  }

  if (earliest.date <= BTC_PRICE_GENESIS) {
    console.log(`[btc-price] Backfill complete — earliest cached: ${earliest.date}`)
    return { status: "complete", earliestDate: earliest.date, newPrices: {} }
  }

  const toTs = Math.floor(new Date(earliest.date).getTime() / 1000)

  console.log(`[btc-price] Backfill: fetching 2000 days ending at ${earliest.date} via CryptoCompare`)

  const url = `${CRYPTOCOMPARE_BASE}/histoday?fsym=BTC&tsym=USD&limit=2000&toTs=${toTs}`
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    console.error(`[btc-price] CryptoCompare returned ${res.status}: ${body.slice(0, 200)}`)
    throw new Error(`CryptoCompare API error: ${res.status}`)
  }

  const json = await res.json()
  if (json.Response !== "Success") {
    console.error(`[btc-price] CryptoCompare error:`, json.Message)
    throw new Error(`CryptoCompare: ${json.Message}`)
  }

  const dataPoints: { time: number; close: number }[] = json.Data?.Data ?? []
  console.log(`[btc-price] CryptoCompare returned ${dataPoints.length} data points`)

  const dayPrices: Record<string, number> = {}
  for (const point of dataPoints) {
    if (point.close <= 0) continue
    const day = new Date(point.time * 1000).toISOString().split("T")[0]
    dayPrices[day] = point.close
  }

  await cachePrices(dayPrices)

  const newEarliest = await prisma.btcPriceCache.findFirst({
    orderBy: { date: "asc" },
  })

  const done = (newEarliest?.date ?? earliest.date) <= BTC_PRICE_GENESIS
  console.log(
    `[btc-price] Backfill cached ${Object.keys(dayPrices).length} prices, earliest now: ${newEarliest?.date}`,
  )

  return {
    status: done ? "complete" : "in_progress",
    earliestDate: newEarliest?.date ?? earliest.date,
    newPrices: dayPrices,
  }
}

async function cachePrices(dayPrices: Record<string, number>) {
  const entries = Object.entries(dayPrices)
  const BATCH = 50
  for (let b = 0; b < entries.length; b += BATCH) {
    const batch = entries.slice(b, b + BATCH)
    await Promise.all(
      batch.map(([date, priceUsd]) =>
        prisma.btcPriceCache.upsert({
          where: { date },
          update: { priceUsd, fetchedAt: new Date() },
          create: { date, priceUsd },
        }),
      ),
    )
  }
}

export async function getCurrentBtcPrice(): Promise<number> {
  const today = new Date().toISOString().split("T")[0]

  const cached = await prisma.btcPriceCache.findUnique({ where: { date: today } })
  if (cached) return cached.priceUsd

  try {
    const res = await fetch(
      `${COINGECKO_BASE}/simple/price?ids=bitcoin&vs_currencies=usd`,
      { next: { revalidate: 300 } },
    )
    if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`)
    const data = await res.json()
    const price = data.bitcoin.usd as number

    await prisma.btcPriceCache.upsert({
      where: { date: today },
      update: { priceUsd: price, fetchedAt: new Date() },
      create: { date: today, priceUsd: price },
    })
    return price
  } catch {
    const latest = await prisma.btcPriceCache.findFirst({ orderBy: { date: "desc" } })
    return latest?.priceUsd ?? 0
  }
}

export function calculateOpportunityCost(amount: number, priceAtPurchase: number, currentPrice: number): number {
  const btcAmount = amount / priceAtPurchase
  return btcAmount * currentPrice
}

export function satsPerDollar(btcPrice: number): number {
  return Math.round(100_000_000 / btcPrice)
}

const SATS_PER_BTC = 100_000_000

export function usdToSats(usd: number, btcPriceUsd: number): number {
  return Math.round((usd / btcPriceUsd) * SATS_PER_BTC)
}

/**
 * Look up the cached BTC price for a specific date (YYYY-MM-DD).
 * Falls back to the nearest earlier cached price, then to getCurrentBtcPrice.
 */
export async function getBtcPriceForDate(date: string): Promise<number | null> {
  const exact = await prisma.btcPriceCache.findUnique({ where: { date } })
  if (exact) return exact.priceUsd

  const nearest = await prisma.btcPriceCache.findFirst({
    where: { date: { lte: date } },
    orderBy: { date: "desc" },
  })
  if (nearest) return nearest.priceUsd

  const current = await getCurrentBtcPrice()
  return current > 0 ? current : null
}
