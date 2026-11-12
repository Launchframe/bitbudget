import { describe, expect, it } from "vitest"
import {
  deletedEnvelopeIdSet,
  discretionaryEnvelopesForAllocations,
  envelopeDeleteUsageStats,
  filterTransactionsForActiveLedger,
} from "@/lib/envelope-ledger-visibility"
import { SYSTEM_ENVELOPE_ROLE_SAVINGS } from "@/lib/constants"

describe("filterTransactionsForActiveLedger", () => {
  const envelopes = [
    { id: "active", archived: false },
    { id: "archived", archived: true },
    { id: "deleted", deletedAt: "2026-05-01T00:00:00.000Z" },
  ]

  const transactions = [
    { envelopeId: "active", amount: 10 },
    { envelopeId: "archived", amount: 20 },
    { envelopeId: "deleted", amount: 30 },
  ]

  it("keeps archived envelope transactions in the ledger", () => {
    const out = filterTransactionsForActiveLedger(transactions, envelopes)
    expect(out.map(t => t.envelopeId)).toEqual(["active", "archived"])
  })

  it("excludes soft-deleted envelope transactions", () => {
    const out = filterTransactionsForActiveLedger(transactions, envelopes)
    expect(out.some(t => t.envelopeId === "deleted")).toBe(false)
  })
})

describe("discretionaryEnvelopesForAllocations", () => {
  it("excludes Savings, archived, and soft-deleted envelopes", () => {
    const rows = discretionaryEnvelopesForAllocations([
      { id: "a", name: "Rent" },
      { id: "sav", name: "Savings", systemRole: SYSTEM_ENVELOPE_ROLE_SAVINGS },
      { id: "arc", name: "Old", archived: true },
      { id: "del", name: "Gone", deletedAt: "2026-05-01T00:00:00.000Z" },
    ])
    expect(rows.map(r => r.id)).toEqual(["a"])
  })
})

describe("envelopeDeleteUsageStats", () => {
  it("counts only user-facing transactions for an envelope", () => {
    const stats = envelopeDeleteUsageStats(
      [
        { envelopeId: "e1", amount: 10, excludeFromMainHistory: false },
        { envelopeId: "e1", amount: 50, excludeFromMainHistory: true },
        { envelopeId: "e2", amount: 99, excludeFromMainHistory: false },
      ],
      [{ envelopeId: "e1" }, { envelopeId: "e1" }],
      "e1",
    )
    expect(stats).toEqual({
      transactionCount: 1,
      transactionTotal: 10,
      recurringCount: 2,
    })
  })
})

describe("deletedEnvelopeIdSet", () => {
  it("returns only envelopes with deletedAt set", () => {
    expect(
      deletedEnvelopeIdSet([
        { id: "a" },
        { id: "b", deletedAt: "2026-01-01T00:00:00.000Z" },
      ]),
    ).toEqual(new Set(["b"]))
  })
})
