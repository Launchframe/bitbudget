import { describe, expect, it } from "vitest"
import {
  findCollidingTransaction,
  normalizeDedupAmount,
  normalizeDedupCents,
  transactionCollisionKey,
} from "@/lib/transaction-dedup"
import type { Transaction } from "@/lib/data"
import { ENCRYPTED_DISPLAY } from "@/lib/encrypted-display"

const baseTxn = (over: Partial<Transaction>): Transaction => ({
  id: "x",
  date: "2026-04-26",
  payee: "Coffee Shop",
  amount: 12.5,
  type: "expense",
  envelopeId: "e1",
  tags: [],
  ...over,
})

describe("normalizeDedupAmount", () => {
  it("rounds to cents", () => {
    expect(normalizeDedupAmount(10)).toBe(10)
    expect(normalizeDedupAmount(10.001)).toBe(10)
    expect(normalizeDedupAmount(10.009)).toBe(10.01)
    expect(normalizeDedupAmount(1.005)).toBe(1.01)
  })
})

describe("normalizeDedupCents", () => {
  it("matches dollar normalization", () => {
    expect(normalizeDedupCents(12.5)).toBe(1250)
    expect(normalizeDedupCents(-12.5)).toBe(1250)
    expect(normalizeDedupCents(Number.NaN)).toBe(0)
  })

  it("falls back when double stringifies as scientific notation", () => {
    const sci = 1e25 // String(1e25) is `1e+25`
    expect(Number.isFinite(Number(`${sci}e2`))).toBe(false)
    const cents = normalizeDedupCents(sci)
    expect(Number.isInteger(cents)).toBe(true)
    expect(normalizeDedupCents(sci)).toBe(Math.round(sci * 100))
  })
})

describe("transactionCollisionKey", () => {
  it("includes type so expense ≠ credit", () => {
    const e = transactionCollisionKey({
      date: "2026-04-26",
      payee: "Refund",
      amount: 25,
      type: "expense",
    })
    const c = transactionCollisionKey({
      date: "2026-04-26",
      payee: "Refund",
      amount: 25,
      type: "credit",
    })
    expect(e).not.toBe(c)
  })

  it("normalizes payee casing", () => {
    expect(
      transactionCollisionKey({
        date: "2026-04-26",
        payee: "  Foo Bar ",
        amount: 1,
        type: "expense",
      }),
    ).toBe(
      transactionCollisionKey({
        date: "2026-04-26",
        payee: "foo bar",
        amount: 1,
        type: "expense",
      }),
    )
  })
})

describe("findCollidingTransaction", () => {
  it("returns matching row", () => {
    const rows = [baseTxn({ id: "a" })]
    const hit = findCollidingTransaction(rows, {
      date: "2026-04-26",
      payee: "coffee shop",
      amount: 12.5,
      type: "expense",
    })
    expect(hit?.id).toBe("a")
  })

  it("returns undefined when payee differs", () => {
    const rows = [baseTxn({})]
    expect(
      findCollidingTransaction(rows, {
        date: "2026-04-26",
        payee: "Tea Shop",
        amount: 12.5,
        type: "expense",
      }),
    ).toBeUndefined()
  })

  it("ignores ciphertext placeholder rows (cannot compare decrypted payees)", () => {
    const rows = [
      baseTxn({ id: "locked", payee: ENCRYPTED_DISPLAY }),
      baseTxn({ id: "open", payee: "Coffee Shop" }),
    ]
    const hit = findCollidingTransaction(rows, {
      date: "2026-04-26",
      payee: "coffee shop",
      amount: 12.5,
      type: "expense",
    })
    expect(hit?.id).toBe("open")
  })

  it("never matches only ciphertext rows even if collision key aligns", () => {
    const rows = [baseTxn({ id: "locked", payee: ENCRYPTED_DISPLAY })]
    expect(
      findCollidingTransaction(rows, {
        date: "2026-04-26",
        payee: ENCRYPTED_DISPLAY,
        amount: 12.5,
        type: "expense",
      }),
    ).toBeUndefined()
  })
})
