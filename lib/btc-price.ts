import { prisma } from "@/lib/db"

const COINGECKO_BASE = "https://api.coingecko.com/api/v3"

/**
 * Fetch BTC/USD daily price history from CoinGecko and cache to DB.
 * Uses /market_chart?days=N which is the most reliable free-tier endpoint.
 * Returns a date-keyed map of prices plus the latest price.
 */
export async function fetchBtcPriceHistory(
  days: number = 365,
): Promise<{ prices: Record<string, number>; currentPrice: number }> {
  // Check what we already have cached
  const cached = await prisma.btcPriceCache.findMany({
    orderBy: { date: "asc" },
  })
  const priceMap: Record<string, number> = {}
  for (const p of cached) priceMap[p.date] = p.priceUsd

  const today = new Date().toISOString().split("T")[0]
  const cachedCount = Object.keys(priceMap).length

  // If we have a good cache (>= 80% of requested days and includes today),
  // return it without hitting CoinGecko
  if (cachedCount >= days * 0.8 && priceMap[today]) {
    return { prices: priceMap, currentPrice: priceMap[today] }
  }

  // Fetch from CoinGecko
  const url = `${COINGECKO_BASE}/coins/bitcoin/market_chart?vs_currency=usd&days=${days}&precision=2`
  console.log(`[btc-price] Fetching from CoinGecko: days=${days}, cached=${cachedCount}`)

  try {
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.error(`[btc-price] CoinGecko returned ${res.status}: ${body.slice(0, 200)}`)
      throw new Error(`CoinGecko ${res.status}`)
    }

    const data = await res.json()
    const rawPrices: [number, number][] = data.prices ?? []
    console.log(`[btc-price] Got ${rawPrices.length} data points from CoinGecko`)

    if (rawPrices.length === 0) {
      throw new Error("CoinGecko returned empty prices array")
    }

    // Deduplicate by day (CoinGecko can return multiple points per day)
    const dayPrices: Record<string, number> = {}
    for (const [ts, price] of rawPrices) {
      const day = new Date(ts).toISOString().split("T")[0]
      dayPrices[day] = price
    }

    // Persist to DB cache (batch upserts)
    const entries = Object.entries(dayPrices)
    const BATCH = 50
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH)
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
    console.log(`[btc-price] Cached ${entries.length} daily prices to DB`)

    const merged = { ...priceMap, ...dayPrices }
    const latestPrice = rawPrices[rawPrices.length - 1][1]
    return { prices: merged, currentPrice: latestPrice }
  } catch (err) {
    console.error("[btc-price] Failed to fetch from CoinGecko:", err)
    // Return whatever we have cached
    const latestEntry = cached[cached.length - 1]
    return {
      prices: priceMap,
      currentPrice: latestEntry?.priceUsd ?? 0,
    }
  }
}

/**
 * Get just the current BTC price (uses simple/price endpoint).
 * Used as a lightweight fallback when full history isn't needed.
 */
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
