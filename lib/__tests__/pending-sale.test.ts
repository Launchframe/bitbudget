import { describe, expect, it } from "vitest"
import {
  parsePendingSaleCreateBody,
  parsePendingSaleUpdateBody,
} from "../pending-sale"

describe("parsePendingSaleCreateBody", () => {
  it("accepts a valid create body", () => {
    const r = parsePendingSaleCreateBody({ sats: 2_000_000, markPriceUsd: 100_000 })
    expect(r).toEqual({ ok: true, value: { sats: 2_000_000, markPriceUsd: 100_000 } })
  })

  it("rejects a non-object body", () => {
    expect(parsePendingSaleCreateBody(null).ok).toBe(false)
    expect(parsePendingSaleCreateBody("x").ok).toBe(false)
  })

  it("rejects zero or negative sats", () => {
    expect(parsePendingSaleCreateBody({ sats: 0, markPriceUsd: 100_000 }).ok).toBe(false)
    expect(parsePendingSaleCreateBody({ sats: -5, markPriceUsd: 100_000 }).ok).toBe(false)
  })

  it("rejects a non-positive mark price", () => {
    expect(parsePendingSaleCreateBody({ sats: 100, markPriceUsd: 0 }).ok).toBe(false)
  })
})

describe("parsePendingSaleUpdateBody", () => {
  it("accepts a status transition to cancelled", () => {
    expect(parsePendingSaleUpdateBody({ status: "cancelled" })).toEqual({
      ok: true,
      value: { status: "cancelled" },
    })
  })

  it("requires proceeds when moving to cash_on_the_way", () => {
    expect(parsePendingSaleUpdateBody({ status: "cash_on_the_way" }).ok).toBe(false)
    expect(
      parsePendingSaleUpdateBody({ status: "cash_on_the_way", proceedsUsd: 1_950 }),
    ).toEqual({ ok: true, value: { status: "cash_on_the_way", proceedsUsd: 1_950 } })
  })

  it("accepts linking with a transaction id", () => {
    expect(
      parsePendingSaleUpdateBody({ status: "linked", linkedTransactionId: "txn_1" }),
    ).toEqual({
      ok: true,
      value: { status: "linked", linkedTransactionId: "txn_1" },
    })
  })

  it("rejects transitioning back to sent", () => {
    expect(parsePendingSaleUpdateBody({ status: "sent" }).ok).toBe(false)
  })

  it("rejects an empty patch", () => {
    expect(parsePendingSaleUpdateBody({}).ok).toBe(false)
  })

  it("clears proceeds / linked id with null", () => {
    expect(parsePendingSaleUpdateBody({ proceedsUsd: null })).toEqual({
      ok: true,
      value: { proceedsUsd: null },
    })
    expect(
      parsePendingSaleUpdateBody({ status: "cancelled", linkedTransactionId: null }),
    ).toEqual({ ok: true, value: { status: "cancelled", linkedTransactionId: null } })
  })

  it("treats a blank transaction id as cleared", () => {
    const r = parsePendingSaleUpdateBody({ status: "linked", linkedTransactionId: "   " })
    expect(r).toEqual({ ok: true, value: { status: "linked", linkedTransactionId: null } })
  })
})
