// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"
import { Prisma } from "@prisma/client"
import {
  currentMonthKeyUtc,
  dedupeImportEntriesByPeriod,
  distributeImportDates,
  entriesIncludeFuturePeriod,
  entriesNeedMonthlyIncome,
  filterImportDatesThroughToday,
  importBatchPeriodKey,
  incomeImportBatchPeriodMatches,
  isImportPeriodFuture,
  isLegacyImportBatchPeriodKey,
  isPeriodCurrent,
  isPeriodCurrentOrFuture,
  parseIncomePeriodKey,
  processIncomeImport,
  resetImportBatchForPeriod,
  resolveImportPayDay,
  splitAmountAcrossChecks,
  shouldFundEnvelopeSliceOnImport,
  sumPriorIncomeImportForPeriod,
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

  it("isImportPeriodFuture distinguishes after current month or year", () => {
    const now = new Date("2026-05-15T12:00:00.000Z")
    expect(isImportPeriodFuture("2026-04", now)).toBe(false)
    expect(isImportPeriodFuture("2026-05", now)).toBe(false)
    expect(isImportPeriodFuture("2026-06", now)).toBe(true)
    expect(isImportPeriodFuture("2025", now)).toBe(false)
    expect(isImportPeriodFuture("2026", now)).toBe(false)
    expect(isImportPeriodFuture("2027", now)).toBe(true)
  })

  it("isPeriodCurrent matches only the current calendar month or year", () => {
    const now = new Date("2026-05-15T12:00:00.000Z")
    expect(isPeriodCurrent("2026-04", now)).toBe(false)
    expect(isPeriodCurrent("2026-05", now)).toBe(true)
    expect(isPeriodCurrent("2026-06", now)).toBe(false)
    expect(isPeriodCurrent("2025", now)).toBe(false)
    expect(isPeriodCurrent("2026", now)).toBe(true)
    expect(isPeriodCurrent("2027", now)).toBe(false)
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

  it("filterImportDatesThroughToday drops future paycheck dates", () => {
    const now = new Date("2026-05-15T12:00:00.000Z")
    const annual = distributeImportDates({ periodKey: "2026", payDay: 15, splitCount: 12 })
    const filtered = filterImportDatesThroughToday(annual, now)
    expect(filtered.length).toBeLessThan(annual.length)
    expect(filtered.every((d) => d <= "2026-05-15")).toBe(true)
    expect(filtered.some((d) => d.startsWith("2026-06"))).toBe(false)
  })

  it("shouldFundEnvelopeSliceOnImport funds current month only for annual rows", () => {
    const now = new Date("2026-05-15T12:00:00.000Z")
    expect(shouldFundEnvelopeSliceOnImport("2026-05", "2026-05-15", now)).toBe(true)
    expect(shouldFundEnvelopeSliceOnImport("2026", "2026-05-15", now)).toBe(true)
    expect(shouldFundEnvelopeSliceOnImport("2026", "2026-04-15", now)).toBe(false)
    expect(shouldFundEnvelopeSliceOnImport("2025", "2025-06-15", now)).toBe(false)
  })

  it("currentMonthKeyUtc matches UTC month", () => {
    expect(currentMonthKeyUtc(new Date("2026-05-23T00:00:00.000Z"))).toBe("2026-05")
  })

  it("entriesNeedMonthlyIncome is true only when a row is the current month or year", () => {
    const now = new Date("2026-05-15T12:00:00.000Z")
    expect(entriesNeedMonthlyIncome([{ periodKey: "2024-01", amount: 1000 }], now)).toBe(false)
    expect(entriesNeedMonthlyIncome([{ periodKey: "2026-05", amount: 1000 }], now)).toBe(true)
    expect(entriesNeedMonthlyIncome([{ periodKey: "2026-06", amount: 1000 }], now)).toBe(false)
    expect(entriesNeedMonthlyIncome([{ periodKey: "2026", amount: 10000 }], now)).toBe(true)
  })

  it("entriesIncludeFuturePeriod detects future rows", () => {
    const now = new Date("2026-05-15T12:00:00.000Z")
    expect(entriesIncludeFuturePeriod([{ periodKey: "2026-05", amount: 1000 }], now)).toBe(false)
    expect(entriesIncludeFuturePeriod([{ periodKey: "2026-06", amount: 1000 }], now)).toBe(true)
    expect(entriesIncludeFuturePeriod([{ periodKey: "2027", amount: 1000 }], now)).toBe(true)
  })
})

describe("isLegacyImportBatchPeriodKey", () => {
  it("matches amount-suffixed legacy keys for month imports", () => {
    expect(isLegacyImportBatchPeriodKey("import-user-1-2026-05-1200", "user-1", "2026-05")).toBe(true)
    expect(isLegacyImportBatchPeriodKey("import-user-1-2026-05-1200.5", "user-1", "2026-05")).toBe(true)
    expect(isLegacyImportBatchPeriodKey("import-user-1-2026-05", "user-1", "2026-05")).toBe(false)
  })

  it("excludes stable month batches when importing a year", () => {
    expect(isLegacyImportBatchPeriodKey("import-user-1-2023-01", "user-1", "2023")).toBe(false)
    expect(isLegacyImportBatchPeriodKey("import-user-1-2023-12", "user-1", "2023")).toBe(false)
    expect(isLegacyImportBatchPeriodKey("import-user-1-2023-5000", "user-1", "2023")).toBe(true)
  })
})

describe("resetImportBatchForPeriod", () => {
  it("clears stable batch transactions but keeps the batch row; deletes legacy batches", async () => {
    const deleteMany = vi.fn()
    const deleteBatch = vi.fn()
    const findMany = vi.fn().mockResolvedValue([{ id: "legacy-1", periodKey: "import-user-1-2026-05-1200" }])
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "stable-1" })
    const create = vi.fn().mockResolvedValue({ id: "stable-1" })

    const tx = {
      envelopeFundingBatch: { findMany, findUnique, create, delete: deleteBatch },
      transaction: { deleteMany },
    } as unknown as Prisma.TransactionClient

    const batch = await resetImportBatchForPeriod(tx, "user-1", "2026-05")

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          kind: ENVELOPE_FUNDING_BATCH_KIND_FUND,
          periodKey: { startsWith: "import-user-1-2026-05-" },
        }),
      }),
    )
    expect(deleteMany).toHaveBeenCalledWith({ where: { fundingBatchId: "legacy-1" } })
    expect(deleteBatch).toHaveBeenCalledWith({ where: { id: "legacy-1" } })
    expect(create).toHaveBeenCalled()
    expect(deleteMany).toHaveBeenCalledWith({ where: { fundingBatchId: "stable-1" } })
    expect(batch).toEqual({ id: "stable-1" })
  })

  it("year import does not delete stable month batches that share the year prefix", async () => {
    const deleteMany = vi.fn()
    const deleteBatch = vi.fn()
    const findMany = vi.fn().mockResolvedValue([
      { id: "month-stable", periodKey: "import-user-1-2023-01" },
      { id: "legacy-year", periodKey: "import-user-1-2023-5000" },
    ])
    const findUnique = vi.fn().mockResolvedValue({ id: "year-stable" })
    const create = vi.fn()

    const tx = {
      envelopeFundingBatch: { findMany, findUnique, create, delete: deleteBatch },
      transaction: { deleteMany },
    } as unknown as Prisma.TransactionClient

    await resetImportBatchForPeriod(tx, "user-1", "2023")

    expect(deleteBatch).toHaveBeenCalledTimes(1)
    expect(deleteBatch).toHaveBeenCalledWith({ where: { id: "legacy-year" } })
    expect(deleteBatch).not.toHaveBeenCalledWith({ where: { id: "month-stable" } })
  })
})

describe("sumPriorIncomeImportForPeriod", () => {
  it("counts only income_import credits in the period", () => {
    const total = sumPriorIncomeImportForPeriod(
      [
        { type: "credit", source: "income_import", amount: 1000, date: "2026-05-10" },
        { type: "credit", source: "paycheck", amount: 5000, date: "2026-05-15" },
        { type: "credit", source: "income_import", amount: 200, date: "2026-04-10" },
      ],
      "2026-05",
    )
    expect(total).toBe(1000)
  })

  it("uses exact import batch period keys when available", () => {
    const total = sumPriorIncomeImportForPeriod(
      [
        {
          type: "credit",
          source: "income_import",
          amount: 1200,
          date: "2023-01-15",
          fundingBatchPeriodKey: "import-user-1-2023-01",
        },
        {
          type: "credit",
          source: "income_import",
          amount: 12000,
          date: "2023-01-15",
          fundingBatchPeriodKey: "import-user-1-2023",
        },
      ],
      "2023",
    )

    expect(total).toBe(12000)
  })
})

describe("incomeImportBatchPeriodMatches", () => {
  it("keeps annual and monthly stable batches independent while accepting legacy amount keys", () => {
    expect(incomeImportBatchPeriodMatches("import-user-1-2023", "2023")).toBe(true)
    expect(incomeImportBatchPeriodMatches("import-user-1-2023-5000", "2023")).toBe(true)
    expect(incomeImportBatchPeriodMatches("import-user-1-2023-01", "2023")).toBe(false)
    expect(incomeImportBatchPeriodMatches("import-user-1-2023-01", "2023-01")).toBe(true)
    expect(incomeImportBatchPeriodMatches("import-user-1-2023-01-500", "2023-01")).toBe(true)
  })
})

describe("processIncomeImport overwrite", () => {
  beforeEach(() => {
    vi.mocked(ensureSystemSavingsEnvelope).mockResolvedValue({ id: "sav-1" } as never)
    vi.mocked(prisma.envelope.findMany).mockResolvedValue([])
  })

  function batchLookup(batches: Map<string, { id: string; periodKey: string }>) {
    return {
      findMany: vi.fn(async ({ where }: { where: { periodKey?: { startsWith?: string } } }) => {
        const prefix = where.periodKey?.startsWith
        if (!prefix) return []
        return [...batches.values()].filter((b) => b.periodKey.startsWith(prefix))
      }),
      findUnique: vi.fn(async ({ where }: { where: { userId_periodKey_kind: { periodKey: string } } }) => {
        const row = batches.get(where.userId_periodKey_kind.periodKey)
        return row ? { id: row.id } : null
      }),
      create: vi.fn(async ({ data }: { data: { periodKey: string } }) => {
        const id = `batch-${batches.size + 1}`
        const row = { id, periodKey: data.periodKey }
        batches.set(data.periodKey, row)
        return row
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        for (const [k, v] of batches) {
          if (v.id === where.id) batches.delete(k)
        }
      }),
    }
  }

  it("re-importing same period+amount replaces prior batch (idempotent row count)", async () => {
    const batches = new Map<string, { id: string; periodKey: string }>()
    const txns: { id: string; fundingBatchId: string | null }[] = []
    let txnSeq = 0

    const tx = {
      envelopeFundingBatch: batchLookup(batches),
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

    const tx = {
      envelopeFundingBatch: batchLookup(batches),
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

    const tx = {
      envelopeFundingBatch: batchLookup(batches),
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
    let created = 0

    const tx = {
      envelopeFundingBatch: batchLookup(batches),
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

  it("dedupes duplicate periodKeys in one request (last wins, single batch reset)", async () => {
    const batches = new Map<string, { id: string; periodKey: string }>()
    const credits: number[] = []
    let deleteManyCalls = 0

    const tx = {
      envelopeFundingBatch: batchLookup(batches),
      transaction: {
        deleteMany: vi.fn(async () => {
          deleteManyCalls += 1
          credits.length = 0
        }),
        create: vi.fn(async ({ data }: { data: { amount: number } }) => {
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
      entries: [
        { periodKey: "2024-01", amount: 1000 },
        { periodKey: "2024-01", amount: 2000 },
      ],
    })

    expect(credits).toEqual([2000])
    expect(deleteManyCalls).toBe(1)
  })
})

describe("dedupeImportEntriesByPeriod", () => {
  it("keeps the last entry per periodKey", () => {
    const result = dedupeImportEntriesByPeriod([
      { periodKey: "2024-01", amount: 100 },
      { periodKey: "2024-02", amount: 200 },
      { periodKey: "2024-01", amount: 300 },
    ])
    expect(result).toEqual([
      { periodKey: "2024-01", amount: 300 },
      { periodKey: "2024-02", amount: 200 },
    ])
  })
})
