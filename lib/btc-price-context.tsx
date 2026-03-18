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

const NOOP_PRICES: BtcPriceContextValue = {
  currentPrice: null,
  priceHistory: [],
  satsPerDollar: 0,
  loading: false,
  backfillStatus: "idle",
  getPriceOnDate: () => 0,
  calculateOpportunityCost: () => 0,
}

/**
 * Returns BTC price context. When called outside BtcPriceProvider (e.g. in
 * vanilla mode where the provider is not mounted), returns safe zero values
 * instead of throwing so components degrade gracefully.
 */
export function useBtcPrices(): BtcPriceContextValue {
  const ctx = useContext(BtcPriceContext)

  if (ctx === null) {
    if (process.env.NODE_ENV !== "production") {
      // This typically indicates a missing <BtcPriceProvider> in the React tree.
      console.warn(
        "[BtcPriceContext] useBtcPrices called outside of BtcPriceProvider; returning NOOP_PRICES.",
      )
    }
    return NOOP_PRICES
  }

  return ctx
}

/**
 * Returns BTC price context if available, or null when no provider is mounted.
 * This is useful when you need to distinguish between "no provider" and
 * "provider present" without any dev-time warnings or fallbacks.
 */
export function useOptionalBtcPrices(): BtcPriceContextValue | null {
  return useContext(BtcPriceContext)
}

function buildSortedHistory(prices: Record<string, number>): BtcPricePoint[] {
  return Object.entries(prices)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, price]) => ({ date, price }))
}

export function BtcPriceProvider({
  children,
  enabled,
}: {
  children: React.ReactNode
  /** When false, no BTC API calls; subtree stays mounted when toggling OC in Settings. */
  enabled: boolean
}) {
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)
  const [priceMap, setPriceMap] = useState<Record<string, number>>({})
  const [priceHistory, setPriceHistory] = useState<BtcPricePoint[]>([])
  const [loading, setLoading] = useState(enabled)
  const [backfillStatus, setBackfillStatus] = useState<"idle" | "in_progress" | "complete" | "error">("idle")
  const fetched = useRef(false)
  const backfillStarted = useRef(false)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  useEffect(() => {
    if (!enabled) {
      // When disabled, stop loading and clear BTC-related state so we don't
      // expose stale opportunity-cost data or skip future fetches.
      setLoading(false)
      setCurrentPrice(null)
      setPriceMap({})
      setPriceHistory([])
      setBackfillStatus("idle")
      fetched.current = false
      backfillStarted.current = false
      return
    }
    if (fetched.current) {
      setLoading(false)
      return
    }
    fetched.current = true
    setLoading(true)

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
  }, [enabled])

  // Background backfill: progressively fetch older data from CoinCap
  useEffect(() => {
    if (!enabled || loading || backfillStarted.current) return
    backfillStarted.current = true

    async function runBackfill() {
      setBackfillStatus("in_progress")
      let retries = 0
      const MAX_RETRIES = 3

      let backfillDone = false
      while (!backfillDone) {
        if (!enabledRef.current) {
          setBackfillStatus("idle")
          break
        }
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
            backfillDone = true
            break
          }

          console.log("[BtcPriceProvider] Backfill chunk done, earliest:", data.earliestDate)
          await new Promise(r => setTimeout(r, 2000))
        } catch (err) {
          retries++
          console.error(`[BtcPriceProvider] Backfill error (attempt ${retries}/${MAX_RETRIES}):`, err)
          if (retries >= MAX_RETRIES) {
            setBackfillStatus("error")
            backfillDone = true
            break
          }
          await new Promise(r => setTimeout(r, 5000 * retries))
        }
      }
    }

    runBackfill()
  }, [enabled, loading])

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
