import { prisma } from "@/lib/db"

const COINGECKO_BASE = "https://api.coingecko.com/api/v3"

/**
 * Fetch the current BTC/USD price from CoinGecko (with DB cache).
 * Falls back to the most recent cached price on API failure.
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
    return latest?.priceUsd ?? 100000
  }
}

/**
 * Retrieve the BTC price for a specific date.
 * Checks DB cache first, then falls back to CoinGecko's historical endpoint.
 */
export async function getBtcPriceOnDate(dateStr: string): Promise<number> {
  const cached = await prisma.btcPriceCache.findUnique({ where: { date: dateStr } })
  if (cached) return cached.priceUsd

  try {
    const [y, m, d] = dateStr.split("-")
    const res = await fetch(
      `${COINGECKO_BASE}/coins/bitcoin/history?date=${d}-${m}-${y}&localization=false`,
    )
    if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`)
    const data = await res.json()
    const price = data.market_data?.current_price?.usd as number

    if (price) {
      await prisma.btcPriceCache.upsert({
        where: { date: dateStr },
        update: { priceUsd: price, fetchedAt: new Date() },
        create: { date: dateStr, priceUsd: price },
      })
    }
    return price ?? 100000
  } catch {
    const nearest = await prisma.btcPriceCache.findFirst({
      where: { date: { lte: dateStr } },
      orderBy: { date: "desc" },
    })
    return nearest?.priceUsd ?? 100000
  }
}

/**
 * Bulk-fetch a date range of BTC prices from CoinGecko's "market_chart/range" endpoint.
 * Caches every day's closing price to the DB.
 */
export async function fetchBtcPriceRange(fromDate: string, toDate: string): Promise<Record<string, number>> {
  const existing = await prisma.btcPriceCache.findMany({
    where: { date: { gte: fromDate, lte: toDate } },
  })
  const priceMap: Record<string, number> = {}
  for (const p of existing) priceMap[p.date] = p.priceUsd

  const from = new Date(fromDate)
  const to = new Date(toDate)
  const allDays: string[] = []
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    allDays.push(d.toISOString().split("T")[0])
  }

  const missingDays = allDays.filter(d => !priceMap[d])
  if (missingDays.length === 0) return priceMap

  try {
    const fromTs = Math.floor(new Date(missingDays[0]).getTime() / 1000)
    const toTs = Math.floor(new Date(missingDays[missingDays.length - 1]).getTime() / 1000) + 86400
    const res = await fetch(
      `${COINGECKO_BASE}/coins/bitcoin/market_chart/range?vs_currency=usd&from=${fromTs}&to=${toTs}`,
    )
    if (!res.ok) throw new Error(`CoinGecko range API error: ${res.status}`)
    const data = await res.json()
    const prices: [number, number][] = data.prices ?? []

    const dayPrices: Record<string, number> = {}
    for (const [ts, price] of prices) {
      const day = new Date(ts).toISOString().split("T")[0]
      dayPrices[day] = price
    }

    const upserts = Object.entries(dayPrices).map(([date, priceUsd]) =>
      prisma.btcPriceCache.upsert({
        where: { date },
        update: { priceUsd, fetchedAt: new Date() },
        create: { date, priceUsd },
      }),
    )
    await Promise.all(upserts)

    return { ...priceMap, ...dayPrices }
  } catch {
    return priceMap
  }
}

export function calculateOpportunityCost(amount: number, priceAtPurchase: number, currentPrice: number): number {
  const btcAmount = amount / priceAtPurchase
  return btcAmount * currentPrice
}

export function satsPerDollar(btcPrice: number): number {
  return Math.round(100_000_000 / btcPrice)
}
