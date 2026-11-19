import { describe, expect, it } from "vitest"
import {
  parsePendingSaleCreateBody,
  parsePendingSaleUpdateBody,
  pendingSaleUpdateError,
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

  it("rejects zero or negative proceeds", () => {
    expect(parsePendingSaleUpdateBody({ status: "cash_on_the_way", proceedsUsd: 0 }).ok).toBe(
      false,
    )
    expect(parsePendingSaleUpdateBody({ proceedsUsd: -10 }).ok).toBe(false)
  })
})

describe("pendingSaleUpdateError", () => {
  it("allows the forward steps and blocks jumps", () => {
    expect(
      pendingSaleUpdateError({ status: "sent", proceedsUsd: null }, { status: "cancelled" }),
    ).toBeNull()
    expect(
      pendingSaleUpdateError(
        { status: "sent", proceedsUsd: null },
        { status: "cash_on_the_way", proceedsUsd: 100 },
      ),
    ).toBeNull()
    expect(
      pendingSaleUpdateError({ status: "sent", proceedsUsd: null }, { status: "linked" }),
    ).toMatch(/can't move/)
    expect(
      pendingSaleUpdateError(
        { status: "cash_on_the_way", proceedsUsd: 80 },
        { status: "linked" },
      ),
    ).toBeNull()
    expect(
      pendingSaleUpdateError({ status: "linked", proceedsUsd: 80 }, { status: "cancelled" }),
    ).toMatch(/can't move/)
    expect(
      pendingSaleUpdateError(
        { status: "cancelled", proceedsUsd: null },
        { status: "cash_on_the_way", proceedsUsd: 10 },
      ),
    ).toMatch(/can't move/)
  })

  it("refuses to clear proceeds while cash is still on the way", () => {
    expect(
      pendingSaleUpdateError(
        { status: "cash_on_the_way", proceedsUsd: 50 },
        { proceedsUsd: null },
      ),
    ).toMatch(/proceeds/)
  })

  it("rejects an unknown current status", () => {
    expect(pendingSaleUpdateError({ status: "nope", proceedsUsd: null }, {})).toMatch(
      /can't be updated/,
    )
  })
})
