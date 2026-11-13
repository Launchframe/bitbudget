import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearShoppingReceiptDraft,
  isShoppingReceiptDraft,
  loadShoppingReceiptAttempt,
  loadShoppingReceiptDraft,
  saveShoppingReceiptAttempt,
  saveShoppingReceiptDraft,
  SHOPPING_RECEIPT_DRAFT_KEY,
} from "../shopping-receipt-draft"

const storage = new Map<string, string>()

beforeEach(() => {
  vi.useFakeTimers()
  storage.clear()
  const memory = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value)
    },
    removeItem: (key: string) => {
      storage.delete(key)
    },
    clear: () => storage.clear(),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size
    },
  }
  Object.defineProperty(globalThis, "sessionStorage", { value: memory, configurable: true })
})

afterEach(() => {
  vi.useRealTimers()
})

function flushDraftSave(): void {
  vi.advanceTimersByTime(400)
}

describe("shopping receipt draft", () => {
  it("restores a draft only for the same group", () => {
    saveShoppingReceiptDraft({
      version: 1,
      groupId: "g1",
      merchant: "Market",
      amount: "12.00",
      rows: [{ key: "a", description: "Milk", amount: "4", requestId: "milk", touched: true }],
    })
    flushDraftSave()
    expect(loadShoppingReceiptDraft("g1")?.merchant).toBe("Market")
    expect(loadShoppingReceiptDraft("g1")?.rows[0]?.touched).toBe(true)
    expect(loadShoppingReceiptDraft("g2")).toBeNull()
  })

  it("drops a draft that does not match the form", () => {
    sessionStorage.setItem(SHOPPING_RECEIPT_DRAFT_KEY, JSON.stringify({ version: 1, groupId: "g1" }))
    expect(isShoppingReceiptDraft({ version: 1, groupId: "g1" })).toBe(false)
    expect(loadShoppingReceiptDraft("g1")).toBeNull()
  })

  it("clears the saved form", () => {
    saveShoppingReceiptDraft({
      version: 1,
      groupId: "g1",
      merchant: "Market",
      amount: "",
      rows: [],
    })
    flushDraftSave()
    clearShoppingReceiptDraft()
    expect(loadShoppingReceiptDraft("g1")).toBeNull()
  })

  it("keeps each group's in-progress receipt id", () => {
    saveShoppingReceiptAttempt({
      version: 1,
      groupId: "g1",
      receiptId: "receipt-1",
      operationId: "op-1",
      draftRevision: 1,
      finalized: false,
      checkoffRequestIds: ["milk"],
    })
    saveShoppingReceiptAttempt({
      version: 1,
      groupId: "g2",
      receiptId: "receipt-2",
      operationId: "op-2",
      draftRevision: null,
      finalized: false,
      checkoffRequestIds: [],
    })
    expect(loadShoppingReceiptAttempt("g1")?.operationId).toBe("op-1")
    expect(loadShoppingReceiptAttempt("g2")?.operationId).toBe("op-2")
  })
})
