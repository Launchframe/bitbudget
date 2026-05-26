import { describe, expect, it } from "vitest"
import {
  bucketIncomeCsvByMonth,
  incomeCsvBucketsToStagedEntries,
  latestYearFromBuckets,
  parseIncomeCsv,
  parseIncomeCsvRows,
} from "../income-import-csv"

describe("income-import-csv", () => {
  const sampleCsv = `Date,Amount,Source
2023-01-15,5000,Acme Corp
2023-01-28,500,Acme Corp
2023-02-01,5200,Acme Corp
03/15/2023,100,Bonus
`

  it("parseIncomeCsvRows reads date, amount, and optional source", () => {
    const { rows, totalRows, skippedRows } = parseIncomeCsvRows(sampleCsv)
    expect(totalRows).toBe(4)
    expect(skippedRows).toBe(0)
    expect(rows).toHaveLength(4)
    expect(rows[0]).toEqual({ date: "2023-01-15", amount: 5000, source: "Acme Corp" })
    expect(rows[3]).toEqual({ date: "2023-03-15", amount: 100, source: "Bonus" })
  })

  it("skips rows with invalid date or non-positive amount", () => {
    const csv = `Date,Amount
bad-date,100
2023-04-01,0
2023-04-02,-50
2023-04-03,200
`
    const { rows, skippedRows } = parseIncomeCsvRows(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.amount).toBe(200)
    expect(skippedRows).toBe(3)
  })

  it("bucketIncomeCsvByMonth sums amounts per YYYY-MM", () => {
    const { rows } = parseIncomeCsvRows(sampleCsv)
    const buckets = bucketIncomeCsvByMonth(rows)
    expect(buckets).toEqual([
      { periodKey: "2023-01", amount: 5500, source: "Acme Corp", rowCount: 2 },
      { periodKey: "2023-02", amount: 5200, source: "Acme Corp", rowCount: 1 },
      { periodKey: "2023-03", amount: 100, source: "Bonus", rowCount: 1 },
    ])
  })

  it("picks dominant source label when a month has mixed sources", () => {
    const buckets = bucketIncomeCsvByMonth([
      { date: "2024-06-01", amount: 100, source: "Side gig" },
      { date: "2024-06-15", amount: 4000, source: "Day job" },
      { date: "2024-06-20", amount: 500, source: "Side gig" },
    ])
    expect(buckets[0]).toMatchObject({ periodKey: "2024-06", amount: 4600, source: "Day job" })
  })

  it("parseIncomeCsv end-to-end", () => {
    const result = parseIncomeCsv(sampleCsv)
    expect(result.buckets).toHaveLength(3)
    expect(result.totalRows).toBe(4)
    expect(result.skippedRows).toBe(0)
  })

  it("parseIncomeCsv drops future month buckets", () => {
    const now = new Date("2026-05-15T12:00:00.000Z")
    const csv = `Date,Amount
2026-04-01,1000
2026-05-01,2000
2026-06-01,3000
`
    const result = parseIncomeCsv(csv, now)
    expect(result.buckets.map((b) => b.periodKey)).toEqual(["2026-04", "2026-05"])
    expect(result.skippedRows).toBe(1)
  })

  it("incomeCsvBucketsToStagedEntries maps to month kind", () => {
    const staged = incomeCsvBucketsToStagedEntries([
      { periodKey: "2023-01", amount: 5500, source: "Acme", rowCount: 2 },
    ])
    expect(staged[0]).toEqual({
      periodKey: "2023-01",
      amount: 5500,
      source: "Acme",
      kind: "month",
    })
  })

  it("latestYearFromBuckets returns year of last bucket", () => {
    expect(
      latestYearFromBuckets([
        { periodKey: "2022-11", amount: 1, rowCount: 1 },
        { periodKey: "2023-03", amount: 2, rowCount: 1 },
      ]),
    ).toBe(2023)
  })

  it("throws on missing required columns", () => {
    expect(() => parseIncomeCsv("Amount\n100")).toThrow(/Date and Amount/)
  })
})
