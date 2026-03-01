"use client"

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react"

interface BtcPricePoint {
  date: string
  price: number
}

interface BtcPriceContextValue {
  currentPrice: number | null
  priceHistory: BtcPricePoint[]
  getPriceOnDate: (date: string) => number
  calculateOpportunityCost: (amount: number, date: string) => number
  satsPerDollar: number
  loading: boolean
}

const BtcPriceContext = createContext<BtcPriceContextValue | null>(null)

export function useBtcPrices(): BtcPriceContextValue {
  const ctx = useContext(BtcPriceContext)
  if (!ctx) throw new Error("useBtcPrices must be used within BtcPriceProvider")
  return ctx
}

export function BtcPriceProvider({ children }: { children: React.ReactNode }) {
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)
  const [priceMap, setPriceMap] = useState<Record<string, number>>({})
  const [priceHistory, setPriceHistory] = useState<BtcPricePoint[]>([])
  const [loading, setLoading] = useState(true)
  const fetched = useRef(false)

  useEffect(() => {
    if (fetched.current) return
    fetched.current = true

    async function load() {
      try {
        // Single API call — server fetches from CoinGecko if needed and caches.
        // CoinGecko free tier caps at 365 days of history.
        const res = await fetch("/api/btc-price?days=365")
        if (!res.ok) throw new Error(`API returned ${res.status}`)

        const data = await res.json()
        const prices: Record<string, number> = data.prices ?? {}
        const current: number = data.currentPrice

        if (current) setCurrentPrice(current)

        if (Object.keys(prices).length > 0) {
          setPriceMap(prices)
          const sorted = Object.entries(prices)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, price]) => ({ date, price }))
          setPriceHistory(sorted)

          // If the main call didn't include a current price, use the latest history point
          if (!current && sorted.length > 0) {
            setCurrentPrice(sorted[sorted.length - 1].price)
          }
        }
      } catch (err) {
        console.error("[BtcPriceProvider] Failed to load price data:", err)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  const getPriceOnDate = useCallback(
    (date: string): number => {
      const d = date.split("T")[0]
      if (priceMap[d]) return priceMap[d]

      let closest = priceHistory[0]?.price ?? currentPrice ?? 0
      for (const point of priceHistory) {
        if (point.date <= d) closest = point.price
        else break
      }
      return closest
    },
    [priceMap, priceHistory, currentPrice],
  )

  const calculateOpportunityCost = useCallback(
    (amount: number, date: string): number => {
      const priceAtPurchase = getPriceOnDate(date)
      if (!priceAtPurchase || !currentPrice) return 0
      const btcAmount = amount / priceAtPurchase
      return btcAmount * currentPrice
    },
    [getPriceOnDate, currentPrice],
  )

  const satsPerDollar = currentPrice ? Math.round(100_000_000 / currentPrice) : 0

  return (
    <BtcPriceContext.Provider
      value={{ currentPrice, priceHistory, getPriceOnDate, calculateOpportunityCost, satsPerDollar, loading }}
    >
      {children}
    </BtcPriceContext.Provider>
  )
}
