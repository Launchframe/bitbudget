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
  backfillStatus: "idle" | "in_progress" | "complete" | "error"
}

const BtcPriceContext = createContext<BtcPriceContextValue | null>(null)

export function useBtcPrices(): BtcPriceContextValue {
  const ctx = useContext(BtcPriceContext)
  if (!ctx) throw new Error("useBtcPrices must be used within BtcPriceProvider")
  return ctx
}

function buildSortedHistory(prices: Record<string, number>): BtcPricePoint[] {
  return Object.entries(prices)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, price]) => ({ date, price }))
}

export function BtcPriceProvider({ children }: { children: React.ReactNode }) {
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)
  const [priceMap, setPriceMap] = useState<Record<string, number>>({})
  const [priceHistory, setPriceHistory] = useState<BtcPricePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [backfillStatus, setBackfillStatus] = useState<"idle" | "in_progress" | "complete" | "error">("idle")
  const fetched = useRef(false)
  const backfillStarted = useRef(false)

  useEffect(() => {
    if (fetched.current) return
    fetched.current = true

    async function load() {
      try {
        const res = await fetch("/api/btc-price?days=365")
        if (!res.ok) throw new Error(`API returned ${res.status}`)

        const data = await res.json()
        const prices: Record<string, number> = data.prices ?? {}
        const current: number = data.currentPrice

        if (current) setCurrentPrice(current)

        if (Object.keys(prices).length > 0) {
          setPriceMap(prices)
          setPriceHistory(buildSortedHistory(prices))

          if (!current) {
            const sorted = buildSortedHistory(prices)
            if (sorted.length > 0) setCurrentPrice(sorted[sorted.length - 1].price)
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

  // Background backfill: progressively fetch older data from CoinCap
  useEffect(() => {
    if (loading || backfillStarted.current) return
    backfillStarted.current = true

    async function runBackfill() {
      setBackfillStatus("in_progress")
      let retries = 0
      const MAX_RETRIES = 3

      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          const res = await fetch("/api/btc-price/backfill", { method: "POST" })
          if (!res.ok) {
            throw new Error(`Backfill returned ${res.status}`)
          }

          retries = 0
          const data = await res.json()
          const newPrices: Record<string, number> = data.newPrices ?? {}

          if (Object.keys(newPrices).length > 0) {
            setPriceMap(prev => {
              const merged = { ...prev, ...newPrices }
              setPriceHistory(buildSortedHistory(merged))
              return merged
            })
          }

          if (data.status === "complete") {
            console.log("[BtcPriceProvider] Backfill complete, earliest:", data.earliestDate)
            setBackfillStatus("complete")
            break
          }

          console.log("[BtcPriceProvider] Backfill chunk done, earliest:", data.earliestDate)
          await new Promise(r => setTimeout(r, 2000))
        } catch (err) {
          retries++
          console.error(`[BtcPriceProvider] Backfill error (attempt ${retries}/${MAX_RETRIES}):`, err)
          if (retries >= MAX_RETRIES) {
            setBackfillStatus("error")
            break
          }
          await new Promise(r => setTimeout(r, 5000 * retries))
        }
      }
    }

    runBackfill()
  }, [loading])

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
      value={{
        currentPrice,
        priceHistory,
        getPriceOnDate,
        calculateOpportunityCost,
        satsPerDollar,
        loading,
        backfillStatus,
      }}
    >
      {children}
    </BtcPriceContext.Provider>
  )
}
