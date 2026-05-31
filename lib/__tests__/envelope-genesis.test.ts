// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"
import type { Transaction } from "@/lib/data"
import {
  envelopeGenesisFloor,
  getEnvelopeBalanceAllTime,
  getTransactionsForEnvelope,
} from "@/lib/data"

// ---------------------------------------------------------------------------
// envelopeGenesisFloor
// ---------------------------------------------------------------------------

describe("envelopeGenesisFloor", () => {
  it("subtracts one UTC day from the ISO date", () => {
    expect(envelopeGenesisFloor("2026-06-01")).toBe("2026-05-31")
    expect(envelopeGenesisFloor("2026-03-01")).toBe("2026-02-28")
    expect(envelopeGenesisFloor("2026-01-01")).toBe("2025-12-31")
  })

  it("handles leap years correctly", () => {
    expect(envelopeGenesisFloor("2024-03-01")).toBe("2024-02-29")
  })

  it("handles full UTC timestamp strings", () => {
    // A user in UTC-5 creating an envelope at 7pm May 31 stores 2026-06-01T00:00:00Z
    expect(envelopeGenesisFloor("2026-06-01T00:00:00.000Z")).toBe("2026-05-31")
  })
})

// ---------------------------------------------------------------------------
// getTransactionsForEnvelope with genesisDateIso
// ---------------------------------------------------------------------------

const makeTxn = (id: string, date: string, type: "expense" | "credit" = "expense"): Transaction => ({
  id,
  date,
  payee: "Test",
  amount: 100,
  type,
  envelopeId: "env-1",
  tags: [],
})

describe("getTransactionsForEnvelope — genesis filtering", () => {
  const txns: Transaction[] = [
    makeTxn("old-1", "2020-03-14"),
    makeTxn("old-2", "2025-12-31"),
    makeTxn("day-before", "2026-05-30"),
    makeTxn("genesis-day", "2026-05-31"),
    makeTxn("after", "2026-06-15"),
  ]

  it("includes all transactions when genesisDateIso is omitted", () => {
    expect(getTransactionsForEnvelope(txns, "env-1")).toHaveLength(5)
  })

  it("excludes transactions strictly before the genesis floor", () => {
    // genesis floor = "2026-05-31" → "old-1", "old-2" excluded; "day-before" excluded
    const filtered = getTransactionsForEnvelope(txns, "env-1", undefined, "2026-05-31")
    expect(filtered.map((t) => t.id)).toEqual(["genesis-day", "after"])
  })

  it("includes same-day transactions (>= comparison, not >)", () => {
    const filtered = getTransactionsForEnvelope(txns, "env-1", undefined, "2026-05-31")
    expect(filtered.some((t) => t.id === "genesis-day")).toBe(true)
  })

  it("can combine monthKey and genesisDateIso", () => {
    const filtered = getTransactionsForEnvelope(txns, "env-1", "2026-06", "2026-05-31")
    expect(filtered.map((t) => t.id)).toEqual(["after"])
  })
})

// ---------------------------------------------------------------------------
// getEnvelopeBalanceAllTime with genesis filtering
// ---------------------------------------------------------------------------

describe("getEnvelopeBalanceAllTime — genesis filtering", () => {
  // Simulates a new envelope created on 2026-05-31 with 5 years of imported history.
  // Genesis floor = envelopeGenesisFloor("2026-05-31") = "2026-05-30"
  const envId = "env-food"

  const txns: Transaction[] = [
    // Pre-genesis: years of historical CSV expenses
    { id: "h1", envelopeId: envId, date: "2021-04-10", payee: "Old expense", amount: 500, type: "expense", tags: [] },
    { id: "h2", envelopeId: envId, date: "2023-11-22", payee: "Old expense", amount: 800, type: "expense", tags: [] },
    { id: "h3", envelopeId: envId, date: "2025-09-05", payee: "Old expense", amount: 200, type: "expense", tags: [] },
    // On genesis day (same calendar day as creation) — must be included
    { id: "g1", envelopeId: envId, date: "2026-05-31", payee: "New expense", amount: 50, type: "expense", tags: [] },
    // First month's funding credit
    { id: "c1", envelopeId: envId, date: "2026-06-01", payee: "Funding", amount: 300, type: "credit", tags: [], source: "envelope_funding_in", excludeFromMainHistory: true },
    // Normal spending after onboarding
    { id: "e1", envelopeId: envId, date: "2026-06-05", payee: "Store", amount: 120, type: "expense", tags: [] },
  ]

  it("without genesis, years of history drive balance deeply negative", () => {
    const balance = getEnvelopeBalanceAllTime(txns, envId)
    // 300 - 500 - 800 - 200 - 50 - 120 = -1370
    expect(balance).toBe(-1370)
  })

  it("with genesis floor, only post-genesis transactions count", () => {
    const genesisFloor = envelopeGenesisFloor("2026-05-31") // "2026-05-30"
    const balance = getEnvelopeBalanceAllTime(txns, envId, genesisFloor)
    // Included: g1 (2026-05-31), c1 (2026-06-01), e1 (2026-06-05)
    // 300 - 50 - 120 = 130
    expect(balance).toBe(130)
  })

  it("genesis floor from day before creation also includes creation-day transactions", () => {
    // Envelope created at "2026-05-31" → floor is "2026-05-30"
    // The "day-before" safety margin means transactions on 2026-05-31 (creation day) ARE included
    const floor = envelopeGenesisFloor("2026-05-31")
    expect(floor).toBe("2026-05-30")
    const txnsJustToday: Transaction[] = [
      { id: "t1", envelopeId: envId, date: "2026-05-31", payee: "Same day", amount: 75, type: "expense", tags: [] },
    ]
    expect(getEnvelopeBalanceAllTime(txnsJustToday, envId, floor)).toBe(-75)
  })

  it("UTC-5 evening onboard: createdAt 2026-06-01 UTC, transaction 2026-05-31 included", () => {
    // User in UTC-5 creates envelope at 7pm May 31 local → stored as 2026-06-01T00:00:00Z
    // Floor = envelopeGenesisFloor("2026-06-01") = "2026-05-31"
    const floor = envelopeGenesisFloor("2026-06-01T00:00:00.000Z")
    expect(floor).toBe("2026-05-31")
    const txnsSameDay: Transaction[] = [
      { id: "t1", envelopeId: envId, date: "2026-05-31", payee: "Same local day", amount: 40, type: "expense", tags: [] },
      { id: "t2", envelopeId: envId, date: "2026-05-30", payee: "Day before", amount: 999, type: "expense", tags: [] },
    ]
    // 2026-05-31 >= "2026-05-31" → included; 2026-05-30 >= "2026-05-31" → excluded
    expect(getEnvelopeBalanceAllTime(txnsSameDay, envId, floor)).toBe(-40)
  })
})

// ---------------------------------------------------------------------------
// envelopeBalancesBeforeBatch — server-side genesis filtering
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  prisma: {
    envelope: { findMany: vi.fn() },
    transaction: { findMany: vi.fn() },
  },
}))

import { prisma } from "@/lib/db"
import { envelopeBalancesBeforeBatch, envelopeBalancesAllTimeBatch } from "../envelope-balance-server"

describe("envelopeBalancesBeforeBatch — genesis filtering", () => {
  beforeEach(() => {
    vi.mocked(prisma.envelope.findMany).mockReset()
    vi.mocked(prisma.transaction.findMany).mockReset()
  })

  it("excludes pre-genesis transactions, counts post-genesis ones", async () => {
    vi.mocked(prisma.envelope.findMany).mockResolvedValue([
      { id: "e1", createdAt: new Date("2026-05-31T00:00:00Z") },
    ] as never)

    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      // Historical CSV — pre-genesis (floor = "2026-05-30")
      { envelopeId: "e1", type: "expense", amount: 500, date: new Date("2021-04-10T00:00:00Z") },
      { envelopeId: "e1", type: "expense", amount: 800, date: new Date("2023-11-22T00:00:00Z") },
      // Same-day creation date — included (>= "2026-05-30")
      { envelopeId: "e1", type: "expense", amount: 50, date: new Date("2026-05-31T00:00:00Z") },
      // Post-genesis credit
      { envelopeId: "e1", type: "credit", amount: 300, date: new Date("2026-06-01T00:00:00Z") },
      { envelopeId: "e1", type: "expense", amount: 120, date: new Date("2026-06-05T00:00:00Z") },
    ] as never)

    const result = await envelopeBalancesBeforeBatch("u1", ["e1"])
    // 300 - 50 - 120 = 130  (historical 500+800 excluded)
    expect(result.get("e1")).toBe(130)
  })

  it("handles UTC-5 evening creation: createdAt 2026-06-01 UTC, floor 2026-05-31", async () => {
    vi.mocked(prisma.envelope.findMany).mockResolvedValue([
      { id: "e1", createdAt: new Date("2026-06-01T00:00:00Z") },
    ] as never)

    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      // Same local date (2026-05-31) but UTC is already next day — must be included
      { envelopeId: "e1", type: "expense", amount: 40, date: new Date("2026-05-31T00:00:00Z") },
      // Day before — excluded (floor = "2026-05-31", this is "2026-05-30")
      { envelopeId: "e1", type: "expense", amount: 999, date: new Date("2026-05-30T00:00:00Z") },
    ] as never)

    const result = await envelopeBalancesBeforeBatch("u1", ["e1"])
    expect(result.get("e1")).toBe(-40)
  })

  it("returns 0 for empty envelopeIds", async () => {
    const result = await envelopeBalancesBeforeBatch("u1", [])
    expect(result.size).toBe(0)
    expect(prisma.envelope.findMany).not.toHaveBeenCalled()
  })

  it("envelopeBalancesAllTimeBatch delegates to envelopeBalancesBeforeBatch", async () => {
    vi.mocked(prisma.envelope.findMany).mockResolvedValue([
      { id: "e1", createdAt: new Date("2026-01-01T00:00:00Z") },
    ] as never)
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      { envelopeId: "e1", type: "credit", amount: 200, date: new Date("2026-03-01T00:00:00Z") },
    ] as never)

    const result = await envelopeBalancesAllTimeBatch("u1", ["e1"])
    expect(result.get("e1")).toBe(200)
  })
})
