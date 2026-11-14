import { describe, expect, it } from "vitest"
import {
  candleUtcDate,
  candlesToDailyCloseMap,
  neoxaCandlesUrl,
  neoxaTickerUrl,
  parseNeoxaCandlesResponse,
  parseNeoxaTickerLastPrice,
} from "@/lib/xbt-price-neoxa"

/** Fixture shaped like the Neoxa HAR for BTCB2_USDC daily candles. */
const SAMPLE_CANDLES = {
  success: true as const,
  pair: "BTCB2_USDC",
  interval: "1d",
  candles: [
    {
      time: 1788220800, // 2026-09-01 UTC
      open: 13.515415,
      high: 220,
      low: 13.515415,
      close: 90,
      volume: 442.6910366,
    },
    {
      time: 1794614400, // 2026-11-14 UTC
      open: 230,
      high: 239,
      low: 211.1,
      close: 224,
      volume: 417.66497844,
    },
  ],
}

const SAMPLE_TICKER = {
  success: true as const,
  pair: "BTCB2_USDC",
  ticker: {
    lastPrice: 224,
    change: -7.96,
    changePercent: -3.43,
    high24h: 239,
    low24h: 211.1,
    volume24h: 421.16,
    quoteVolume24h: 92719.12,
    trades24h: 1993,
    computedAt: 1794699119967,
    bestBid: 224,
    bestAsk: 224.12,
    spread: 0.12,
  },
}

describe("parseNeoxaCandlesResponse", () => {
  it("returns candles from a successful Neoxa payload", () => {
    const candles = parseNeoxaCandlesResponse(SAMPLE_CANDLES)
    expect(candles).toHaveLength(2)
    expect(candles[0].close).toBe(90)
    expect(candles[1].close).toBe(224)
  })

  it("skips malformed candle rows but keeps valid ones", () => {
    const candles = parseNeoxaCandlesResponse({
      success: true,
      candles: [
        SAMPLE_CANDLES.candles[0],
        { time: 1, open: "bad", high: 1, low: 1, close: 1, volume: 0 },
        SAMPLE_CANDLES.candles[1],
      ],
    })
    expect(candles).toHaveLength(2)
  })

  it("throws when success is false", () => {
    expect(() =>
      parseNeoxaCandlesResponse({ success: false, message: "API endpoint not found" }),
    ).toThrow(/API endpoint not found/)
  })

  it("throws when candles is missing", () => {
    expect(() => parseNeoxaCandlesResponse({ success: true })).toThrow(/missing candles/)
  })
})

describe("candlesToDailyCloseMap", () => {
  it("maps each candle to its UTC date close", () => {
    const candles = parseNeoxaCandlesResponse(SAMPLE_CANDLES)
    const map = candlesToDailyCloseMap(candles)
    expect(map["2026-09-01"]).toBe(90)
    expect(map["2026-11-14"]).toBe(224)
  })

  it("later same-day candles win", () => {
    const map = candlesToDailyCloseMap([
      {
        time: 1788220800,
        open: 1,
        high: 2,
        low: 1,
        close: 10,
        volume: 1,
      },
      {
        time: 1788220800 + 3600,
        open: 1,
        high: 2,
        low: 1,
        close: 12,
        volume: 1,
      },
    ])
    expect(map["2026-09-01"]).toBe(12)
  })

  it("drops non-positive closes", () => {
    const map = candlesToDailyCloseMap([
      {
        time: 1788220800,
        open: 1,
        high: 2,
        low: 0.1,
        close: 0,
        volume: 1,
      },
    ])
    expect(map).toEqual({})
  })
})

describe("candleUtcDate", () => {
  it("formats unix seconds as YYYY-MM-DD UTC", () => {
    expect(candleUtcDate(1788220800)).toBe("2026-09-01")
    expect(candleUtcDate(1794614400)).toBe("2026-11-14")
  })
})

describe("parseNeoxaTickerLastPrice", () => {
  it("reads lastPrice from a successful ticker", () => {
    expect(parseNeoxaTickerLastPrice(SAMPLE_TICKER)).toBe(224)
  })

  it("returns null for failures or bad prices", () => {
    expect(parseNeoxaTickerLastPrice({ success: false })).toBeNull()
    expect(
      parseNeoxaTickerLastPrice({ success: true, ticker: { lastPrice: 0 } }),
    ).toBeNull()
    expect(parseNeoxaTickerLastPrice(null)).toBeNull()
  })
})

describe("neoxa URL builders", () => {
  it("builds candles and ticker URLs for BTCB2_USDC", () => {
    expect(neoxaCandlesUrl()).toBe(
      "https://neoxa.exchange/api/exchange/candles/BTCB2_USDC?interval=1d&limit=500",
    )
    expect(neoxaTickerUrl()).toBe(
      "https://neoxa.exchange/api/exchange/ticker/BTCB2_USDC",
    )
  })
})
