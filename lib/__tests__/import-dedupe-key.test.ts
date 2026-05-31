import { describe, expect, it } from "vitest"
import { makeDedupeKeyComputer, type DedupeCandidate } from "@/lib/import-dedupe-key"

// 32-byte (64 hex char) seeds, like the cached privacy-key hex.
const SEED_A = "11".repeat(32)
const SEED_B = "22".repeat(32)

const coffee = (over: Partial<DedupeCandidate> = {}): DedupeCandidate => ({
  date: "2026-04-26",
  payee: "Coffee Shop",
  amount: 12.5,
  type: "expense",
  ...over,
})

describe("makeDedupeKeyComputer", () => {
  it("is deterministic for the same seed + transaction + occurrence", () => {
    const a = makeDedupeKeyComputer(SEED_A)
    const b = makeDedupeKeyComputer(SEED_A)
    expect(a(coffee())).toBe(b(coffee()))
  })

  it("produces a 32-char (128-bit) hex key", () => {
    const compute = makeDedupeKeyComputer(SEED_A)
    const key = compute(coffee())
    expect(key).toMatch(/^[0-9a-f]{32}$/)
  })

  it("differs per seed (server cannot reproduce without the seed)", () => {
    const a = makeDedupeKeyComputer(SEED_A)
    const b = makeDedupeKeyComputer(SEED_B)
    expect(a(coffee())).not.toBe(b(coffee()))
  })

  it("differs when any business field changes", () => {
    const compute = makeDedupeKeyComputer(SEED_A)
    const base = makeDedupeKeyComputer(SEED_A)(coffee())
    expect(compute(coffee({ amount: 12.51 }))).not.toBe(base)

    const compute2 = makeDedupeKeyComputer(SEED_A)
    expect(compute2(coffee({ payee: "Tea Shop" }))).not.toBe(base)

    const compute3 = makeDedupeKeyComputer(SEED_A)
    expect(compute3(coffee({ date: "2026-04-27" }))).not.toBe(base)

    const compute4 = makeDedupeKeyComputer(SEED_A)
    expect(compute4(coffee({ type: "credit" }))).not.toBe(base)
  })

  it("normalizes payee case/whitespace and amount precision like the collision key", () => {
    const a = makeDedupeKeyComputer(SEED_A)(coffee())
    const b = makeDedupeKeyComputer(SEED_A)(coffee({ payee: "  coffee shop  ", amount: 12.5 }))
    expect(a).toBe(b)
  })

  it("gives repeated identical rows distinct keys via the occurrence counter", () => {
    const compute = makeDedupeKeyComputer(SEED_A)
    const first = compute(coffee())
    const second = compute(coffee())
    const third = compute(coffee())
    expect(new Set([first, second, third]).size).toBe(3)
  })

  it("reproduces the same key sequence when re-importing the same file in order", () => {
    const file = [coffee(), coffee(), coffee({ payee: "Grocer", amount: 40 })]

    const run1 = makeDedupeKeyComputer(SEED_A)
    const keys1 = file.map(run1)

    const run2 = makeDedupeKeyComputer(SEED_A)
    const keys2 = file.map(run2)

    expect(keys2).toEqual(keys1)
  })

  it("rejects an invalid seed hex", () => {
    expect(() => makeDedupeKeyComputer("not-hex")).toThrow()
    expect(() => makeDedupeKeyComputer("abc")).toThrow()
  })
})
