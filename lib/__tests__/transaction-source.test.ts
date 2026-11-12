import { describe, expect, it } from "vitest"
import { TRANSACTION_SOURCES, isTransactionSource } from "@/lib/data"

describe("TRANSACTION_SOURCES", () => {
  it("includes the new onchain_xpub source", () => {
    expect(TRANSACTION_SOURCES).toContain("onchain_xpub")
  })

  it("includes all known historical sources", () => {
    for (const src of [
      "manual",
      "voice",
      "receipt_scan",
      "sms",
      "email_forward",
      "email_scan",
      "plaid",
    ] as const) {
      expect(TRANSACTION_SOURCES).toContain(src)
    }
  })
})

describe("isTransactionSource", () => {
  it("accepts every value in TRANSACTION_SOURCES", () => {
    for (const src of TRANSACTION_SOURCES) {
      expect(isTransactionSource(src)).toBe(true)
    }
  })

  it("rejects unknown strings", () => {
    expect(isTransactionSource("zelle")).toBe(false)
    expect(isTransactionSource("ONCHAIN_XPUB")).toBe(false)
    expect(isTransactionSource("")).toBe(false)
  })

  it("rejects non-strings", () => {
    expect(isTransactionSource(null)).toBe(false)
    expect(isTransactionSource(undefined)).toBe(false)
    expect(isTransactionSource(42)).toBe(false)
    expect(isTransactionSource({ source: "manual" })).toBe(false)
  })
})
