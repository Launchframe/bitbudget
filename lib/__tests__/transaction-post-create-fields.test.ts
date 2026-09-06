import { describe, expect, it } from "vitest"
import {
  CLIENT_POST_SOURCES,
  excludeFromMainHistoryForCreate,
  normalizeTransactionSourceForCreate,
} from "@/lib/transaction-post-create-fields"

describe("normalizeTransactionSourceForCreate", () => {
  it("defaults to manual", () => {
    expect(normalizeTransactionSourceForCreate(undefined)).toBe("manual")
    expect(normalizeTransactionSourceForCreate(null)).toBe("manual")
    expect(normalizeTransactionSourceForCreate("")).toBe("manual")
    expect(normalizeTransactionSourceForCreate("   ")).toBe("manual")
  })

  it("allows client post sources only", () => {
    for (const s of CLIENT_POST_SOURCES) {
      expect(normalizeTransactionSourceForCreate(s)).toBe(s)
    }
    expect(normalizeTransactionSourceForCreate("paycheck_import")).toEqual({
      error: "Invalid source",
    })
  })
})

describe("excludeFromMainHistoryForCreate", () => {
  it("forces true for rules-engine satellite sources", () => {
    expect(excludeFromMainHistoryForCreate("round_up", false)).toBe(true)
    expect(excludeFromMainHistoryForCreate("round_up", true)).toBe(true)
    expect(excludeFromMainHistoryForCreate("surplus_sweep", undefined)).toBe(true)
  })

  it("allows manual skip-main-history (New Transaction skip rule)", () => {
    expect(excludeFromMainHistoryForCreate("manual", true)).toBe(true)
    expect(excludeFromMainHistoryForCreate("manual", false)).toBe(false)
    expect(excludeFromMainHistoryForCreate("manual", undefined)).toBe(false)
    expect(excludeFromMainHistoryForCreate("manual", null)).toBe(false)
  })

  it("rejects non-boolean exclude for manual", () => {
    expect(excludeFromMainHistoryForCreate("manual", "yes")).toEqual({
      error: "excludeFromMainHistory must be a boolean",
    })
  })
})
