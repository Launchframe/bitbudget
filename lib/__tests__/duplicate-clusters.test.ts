import { describe, expect, it } from "vitest"
import {
  defaultDeleteSelection,
  duplicateRowCount,
  findDuplicateClusters,
  isCleanupEligible,
} from "@/lib/duplicate-clusters"
import type { Transaction } from "@/lib/data"
import { ENCRYPTED_DISPLAY } from "@/lib/encrypted-display"

const txn = (over: Partial<Transaction>): Transaction => ({
  id: "t1",
  date: "2026-04-26",
  payee: "Coffee Shop",
  amount: 12.5,
  type: "expense",
  envelopeId: "e1",
  tags: [],
  source: "csv_import",
  createdAt: "2026-04-26T10:00:00.000Z",
  ...over,
})

describe("findDuplicateClusters", () => {
  it("groups rows sharing date/type/payee/amount and ignores singletons", () => {
    const rows = [
      txn({ id: "a", createdAt: "2026-04-26T10:00:00.000Z" }),
      txn({ id: "b", createdAt: "2026-04-26T11:00:00.000Z" }),
      txn({ id: "c", payee: "Grocer", amount: 40 }),
    ]
    const clusters = findDuplicateClusters(rows)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].transactions.map((t) => t.id)).toEqual(["a", "b"])
  })

  it("sorts each cluster oldest-first so the keeper is index 0", () => {
    const rows = [
      txn({ id: "newer", createdAt: "2026-04-26T12:00:00.000Z" }),
      txn({ id: "older", createdAt: "2026-04-26T08:00:00.000Z" }),
    ]
    const [cluster] = findDuplicateClusters(rows)
    expect(cluster.transactions[0].id).toBe("older")
  })

  it("excludes locked / undecrypted rows", () => {
    const rows = [
      txn({ id: "a", isDecrypted: false, payee: ENCRYPTED_DISPLAY }),
      txn({ id: "b", isDecrypted: false, payee: ENCRYPTED_DISPLAY }),
    ]
    expect(findDuplicateClusters(rows)).toHaveLength(0)
  })

  it("excludes funding legs and batch-owning rows", () => {
    const rows = [
      txn({ id: "a", source: "envelope_funding_out", excludeFromMainHistory: true }),
      txn({ id: "b", source: "envelope_funding_out", excludeFromMainHistory: true }),
    ]
    expect(findDuplicateClusters(rows)).toHaveLength(0)

    const income = [
      txn({ id: "c", type: "credit", source: "income_import", fundingBatchId: "batch1" }),
      txn({ id: "d", type: "credit", source: "income_import", fundingBatchId: "batch1" }),
    ]
    expect(findDuplicateClusters(income)).toHaveLength(0)
  })

  it("sorts clusters largest-first", () => {
    const rows = [
      txn({ id: "p1", payee: "Pair", amount: 5 }),
      txn({ id: "p2", payee: "Pair", amount: 5 }),
      txn({ id: "t1", payee: "Trio", amount: 9 }),
      txn({ id: "t2", payee: "Trio", amount: 9 }),
      txn({ id: "t3", payee: "Trio", amount: 9 }),
    ]
    const clusters = findDuplicateClusters(rows)
    expect(clusters[0].transactions).toHaveLength(3)
    expect(clusters[1].transactions).toHaveLength(2)
  })
})

describe("defaultDeleteSelection / duplicateRowCount", () => {
  it("selects all but the keeper in each cluster", () => {
    const rows = [
      txn({ id: "a", createdAt: "2026-04-26T08:00:00.000Z" }),
      txn({ id: "b", createdAt: "2026-04-26T09:00:00.000Z" }),
      txn({ id: "c", createdAt: "2026-04-26T10:00:00.000Z" }),
    ]
    const clusters = findDuplicateClusters(rows)
    const selection = defaultDeleteSelection(clusters)
    expect(selection.has("a")).toBe(false)
    expect(selection.has("b")).toBe(true)
    expect(selection.has("c")).toBe(true)
    expect(duplicateRowCount(clusters)).toBe(2)
  })
})

describe("isCleanupEligible", () => {
  it("accepts a plain decrypted import row", () => {
    expect(isCleanupEligible(txn({}))).toBe(true)
  })
  it("rejects locked rows", () => {
    expect(isCleanupEligible(txn({ isDecrypted: false }))).toBe(false)
  })
})
