// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"
import { Prisma } from "@prisma/client"
import {
  currentMonthKeyUtc,
  deletePriorImportForPeriod,
  distributeImportDates,
  entriesNeedMonthlyIncome,
  importBatchPeriodKey,
  isPeriodCurrentOrFuture,
  parseIncomePeriodKey,
  processIncomeImport,
  resolveImportPayDay,
  splitAmountAcrossChecks,
} from "../income-import"
import { ENVELOPE_FUNDING_BATCH_KIND_FUND } from "../constants"

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    envelope: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/envelope-funding", () => ({
  ensureSystemSavingsEnvelope: vi.fn(),
  TX_SOURCE_FUNDING_IN: "envelope_funding_in",
  TX_SOURCE_FUNDING_OUT: "envelope_funding_out",
  TX_SOURCE_IRREGULAR_INCOME: "irregular_income",
  TX_SOURCE_PAYCHECK: "paycheck",
}))

vi.mock("@/lib/server-encrypt", () => ({
  encryptFieldForUser: vi.fn((text: string) => `enc:${text}`),
}))

vi.mock("@/lib/btc-price", () => ({
  getBtcPriceForDate: vi.fn(async () => 50000),
  usdToSats: vi.fn((usd: number) => Math.round((usd / 50000) * 1e8)),
}))

import { prisma } from "@/lib/db"
import { ensureSystemSavingsEnvelope } from "@/lib/envelope-funding"

describe("income-import helpers", () => {
  it("parseIncomePeriodKey accepts YYYY-MM and YYYY", () => {
    expect(parseIncomePeriodKey("2026-05")).toEqual({
      kind: "month",
      year: 2026,
      month: 5,
      periodKey: "2026-05",
    })
    expect(parseIncomePeriodKey("2025")).toEqual({
      kind: "year",
      year: 2025,
      periodKey: "2025",
    })
    expect(parseIncomePeriodKey("2026-13")).toBeNull()
  })

  it("isPeriodCurrentOrFuture distinguishes past vs current/future", () => {
    const now = new Date("2026-05-15T12:00:00.000Z")
    expect(isPeriodCurrentOrFuture("2026-04", now)).toBe(false)
    expect(isPeriodCurrentOrFuture("2026-05", now)).toBe(true)
    expect(isPeriodCurrentOrFuture("2026-06", now)).toBe(true)
    expect(isPeriodCurrentOrFuture("2025", now)).toBe(false)
    expect(isPeriodCurrentOrFuture("2026", now)).toBe(true)
  })

  it("importBatchPeriodKey is one batch per user+period", () => {
    expect(importBatchPeriodKey("user-1", "2026-05")).toBe("import-user-1-2026-05")
    expect(importBatchPeriodKey("user-1", "2025")).toBe("import-user-1-2025")
  })

  it("resolveImportPayDay prefers payDays then defaults to 15", () => {
    expect(resolveImportPayDay([1, 15])).toBe(1)
    expect(resolveImportPayDay([])).toBe(15)
  })

  it("splitAmountAcrossChecks sums to gross", () => {
    expect(splitAmountAcrossChecks(100, 3).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2)
    expect(splitAmountAcrossChecks(100.01, 4).reduce((a, b) => a + b, 0)).toBeCloseTo(100.01, 2)
  })

  it("distributeImportDates returns dates inside the period", () => {
    const dates = distributeImportDates({ periodKey: "2026-05", payDay: 15, splitCount: 2 })
    expect(dates.length).toBe(2)
    for (const d of dates) {
      expect(d.startsWith("2026-05")).toBe(true)
    }
  })

  it("currentMonthKeyUtc matches UTC month", () => {
    expect(currentMonthKeyUtc(new Date("2026-05-23T00:00:00.000Z"))).toBe("2026-05")
  })

  it("entriesNeedMonthlyIncome is true when any row is current or future", () => {
    const now = new Date("2026-05-15T12:00:00.000Z")
    expect(entriesNeedMonthlyIncome([{ periodKey: "2024-01", amount: 1000 }], now)).toBe(false)
    expect(entriesNeedMonthlyIncome([{ periodKey: "2026-05", amount: 1000 }], now)).toBe(true)
    expect(entriesNeedMonthlyIncome([{ periodKey: "2026-06", amount: 1000 }], now)).toBe(true)
  })
})

describe("deletePriorImportForPeriod", () => {
  it("deletes batch transactions then batch row", async () => {
    const deleteMany = vi.fn()
    const deleteBatch = vi.fn()
    const findMany = vi.fn().mockResolvedValue([{ id: "batch-1" }])

    const tx = {
      envelopeFundingBatch: { findMany, delete: deleteBatch },
      transaction: { deleteMany },
    } as unknown as Prisma.TransactionClient

    await deletePriorImportForPeriod(tx, "user-1", "2026-05")

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          kind: ENVELOPE_FUNDING_BATCH_KIND_FUND,
        }),
      }),
    )
    expect(deleteMany).toHaveBeenCalledWith({ where: { fundingBatchId: "batch-1" } })
    expect(deleteBatch).toHaveBeenCalledWith({ where: { id: "batch-1" } })
  })
})

describe("processIncomeImport overwrite", () => {
  beforeEach(() => {
    vi.mocked(ensureSystemSavingsEnvelope).mockResolvedValue({ id: "sav-1" } as never)
    vi.mocked(prisma.envelope.findMany).mockResolvedValue([])
  })

  it("re-importing same period+amount replaces prior batch (idempotent row count)", async () => {
    const batches = new Map<string, { id: string; periodKey: string }>()
    const txns: { id: string; fundingBatchId: string | null }[] = []
    let batchSeq = 0
    let txnSeq = 0

    const tx = {
      envelopeFundingBatch: {
        findMany: vi.fn(async ({ where }: { where: { OR?: { periodKey?: string | { startsWith?: string } }[] } }) => {
          const keys = new Set<string>()
          for (const clause of where.OR ?? []) {
            if ("periodKey" in clause && typeof clause.periodKey === "string") keys.add(clause.periodKey)
            if ("periodKey" in clause && typeof clause.periodKey === "object" && clause.periodKey?.startsWith) {
              const prefix = clause.periodKey.startsWith
              for (const b of batches.values()) {
                if (b.periodKey.startsWith(prefix)) keys.add(b.periodKey)
              }
            }
          }
          return [...batches.values()].filter((b) => keys.has(b.periodKey))
        }),
        create: vi.fn(async ({ data }: { data: { periodKey: string } }) => {
          const id = `batch-${++batchSeq}`
          const row = { id, periodKey: data.periodKey }
          batches.set(data.periodKey, row)
          return row
        }),
        delete: vi.fn(async ({ where }: { where: { id: string } }) => {
          for (const [k, v] of batches) {
            if (v.id === where.id) batches.delete(k)
          }
        }),
      },
      transaction: {
        deleteMany: vi.fn(async ({ where }: { where: { fundingBatchId: string } }) => {
          for (let i = txns.length - 1; i >= 0; i--) {
            if (txns[i]!.fundingBatchId === where.fundingBatchId) txns.splice(i, 1)
          }
        }),
        create: vi.fn(async ({ data }: { data: { fundingBatchId?: string | null } }) => {
          const row = { id: `txn-${++txnSeq}`, fundingBatchId: data.fundingBatchId ?? null }
          txns.push(row)
          return row
        }),
      },
    }

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(tx as never))

    const input = {
      userId: "user-1",
      publicKey: "pk",
      monthlyIncome: 5000,
      payDays: [15],
      entries: [{ periodKey: "2024-01", amount: 1200 }],
    }

    const first = await processIncomeImport(input)
    expect(first).toBe(1)
    expect(txns.length).toBe(1)

    const second = await processIncomeImport(input)
    expect(second).toBe(1)
    expect(txns.length).toBe(1)
    expect(batches.size).toBe(1)
  })

  it("re-importing same period with new amount overwrites prior credits", async () => {
    const batches = new Map<string, { id: string; periodKey: string }>()
    const credits: number[] = []
    let batchSeq = 0

    const tx = {
      envelopeFundingBatch: {
        findMany: vi.fn(async () => [...batches.values()]),
        create: vi.fn(async ({ data }: { data: { periodKey: string } }) => {
          const id = `batch-${++batchSeq}`
          const row = { id, periodKey: data.periodKey }
          batches.set(data.periodKey, row)
          return row
        }),
        delete: vi.fn(async ({ where }: { where: { id: string } }) => {
          for (const [k, v] of batches) {
            if (v.id === where.id) batches.delete(k)
          }
        }),
      },
      transaction: {
        deleteMany: vi.fn(async () => {
          credits.length = 0
        }),
        create: vi.fn(async ({ data }: { data: { amount: number; fundingBatchId?: string | null } }) => {
          credits.push(data.amount)
          return { id: "t" }
        }),
      },
    }

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(tx as never))

    await processIncomeImport({
      userId: "user-1",
      publicKey: "pk",
      monthlyIncome: 5000,
      payDays: [15],
      entries: [{ periodKey: "2024-02", amount: 1000 }],
    })
    expect(credits).toEqual([1000])

    await processIncomeImport({
      userId: "user-1",
      publicKey: "pk",
      monthlyIncome: 5000,
      payDays: [15],
      entries: [{ periodKey: "2024-02", amount: 1500 }],
    })
    expect(credits).toEqual([1500])
  })

  it("re-importing past period does not delete current-month batch", async () => {
    const batches = new Map<string, { id: string; periodKey: string }>()
    const txnsByBatch = new Map<string, number>()
    let batchSeq = 0

    const tx = {
      envelopeFundingBatch: {
        findMany: vi.fn(async ({ where }: { where: { OR?: { periodKey?: string | { startsWith?: string } }[] } }) => {
          const matchKeys = new Set<string>()
          for (const clause of where.OR ?? []) {
            if ("periodKey" in clause && typeof clause.periodKey === "string") matchKeys.add(clause.periodKey)
            if ("periodKey" in clause && typeof clause.periodKey === "object" && clause.periodKey?.startsWith) {
              const prefix = clause.periodKey.startsWith
              for (const b of batches.values()) {
                if (b.periodKey.startsWith(prefix)) matchKeys.add(b.periodKey)
              }
            }
          }
          return [...batches.values()].filter((b) => matchKeys.has(b.periodKey))
        }),
        create: vi.fn(async ({ data }: { data: { periodKey: string } }) => {
          const id = `batch-${++batchSeq}`
          const row = { id, periodKey: data.periodKey }
          batches.set(data.periodKey, row)
          txnsByBatch.set(id, 0)
          return row
        }),
        delete: vi.fn(async ({ where }: { where: { id: string } }) => {
          for (const [k, v] of batches) {
            if (v.id === where.id) {
              batches.delete(k)
              txnsByBatch.delete(v.id)
            }
          }
        }),
      },
      transaction: {
        deleteMany: vi.fn(async ({ where }: { where: { fundingBatchId: string } }) => {
          txnsByBatch.set(where.fundingBatchId, 0)
        }),
        create: vi.fn(async ({ data }: { data: { fundingBatchId?: string | null } }) => {
          const id = data.fundingBatchId
          if (id) txnsByBatch.set(id, (txnsByBatch.get(id) ?? 0) + 1)
          return { id: "t" }
        }),
      },
    }

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(tx as never))

    const base = {
      userId: "user-1",
      publicKey: "pk",
      monthlyIncome: 5000,
      payDays: [15] as number[],
    }

    await processIncomeImport({ ...base, entries: [{ periodKey: "2026-05", amount: 5000 }] })
    await processIncomeImport({ ...base, entries: [{ periodKey: "2024-01", amount: 1200 }] })

    expect(batches.size).toBe(2)
    const currentKey = importBatchPeriodKey("user-1", "2026-05")
    const pastKey = importBatchPeriodKey("user-1", "2024-01")
    expect(txnsByBatch.get(batches.get(currentKey)!.id)).toBe(1)
    expect(txnsByBatch.get(batches.get(pastKey)!.id)).toBe(1)
  })

  it("historical-only import succeeds when monthlyIncome is zero", async () => {
    const batches = new Map<string, { id: string; periodKey: string }>()
    let batchSeq = 0
    let created = 0

    const tx = {
      envelopeFundingBatch: {
        findMany: vi.fn(async () => []),
        create: vi.fn(async ({ data }: { data: { periodKey: string } }) => {
          const id = `batch-${++batchSeq}`
          const row = { id, periodKey: data.periodKey }
          batches.set(data.periodKey, row)
          return row
        }),
        delete: vi.fn(),
      },
      transaction: {
        deleteMany: vi.fn(),
        create: vi.fn(async () => {
          created += 1
          return { id: "t" }
        }),
      },
    }

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(tx as never))

    const count = await processIncomeImport({
      userId: "user-1",
      publicKey: "pk",
      monthlyIncome: 0,
      payDays: [15],
      entries: [{ periodKey: "2024-06", amount: 5000 }],
    })

    expect(count).toBe(1)
    expect(created).toBe(1)
  })
})
