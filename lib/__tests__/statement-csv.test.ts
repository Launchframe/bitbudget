import { describe, it, expect } from "vitest"
import {
  parseFoldDate,
  isFoldStatementCsv,
  parseFoldStatementCsv,
} from "@/lib/statement-csv"

// ─── parseFoldDate ────────────────────────────────────────────────────────────

describe("parseFoldDate", () => {
  it("extracts date from ISO 8601 with offset", () => {
    expect(parseFoldDate("2026-01-01 17:30:34+00:00")).toBe("2026-01-01")
  })

  it("extracts date from datetime without offset", () => {
    expect(parseFoldDate("2026-01-02 06:19")).toBe("2026-01-02")
  })

  it("extracts bare YYYY-MM-DD", () => {
    expect(parseFoldDate("2026-03-15")).toBe("2026-03-15")
  })

  it("returns null for empty string", () => {
    expect(parseFoldDate("")).toBeNull()
  })

  it("returns null for non-date strings", () => {
    expect(parseFoldDate("Starting balance")).toBeNull()
    expect(parseFoldDate("Account Number")).toBeNull()
  })
})

// ─── isFoldStatementCsv ───────────────────────────────────────────────────────

describe("isFoldStatementCsv", () => {
  it("returns true for Fold header columns", () => {
    expect(
      isFoldStatementCsv(["transaction id", "settlement date", "description", "amount"]),
    ).toBe(true)
  })

  it("returns false for generic CSV headers", () => {
    expect(isFoldStatementCsv(["date", "payee", "amount", "category"])).toBe(false)
  })

  it("returns false for missing columns", () => {
    expect(isFoldStatementCsv(["transaction id", "settlement date"])).toBe(false)
  })

  it("is case-insensitive", () => {
    expect(
      isFoldStatementCsv(["Transaction ID", "Settlement Date", "Description", "Amount"]),
    ).toBe(true)
  })
})

// ─── parseFoldStatementCsv ────────────────────────────────────────────────────

const FOLD_CSV_SAMPLE = `"Transaction ID","Settlement Date","Description","Amount"
e679fe4c-4ae8-4c08-b649-fbd692164c53,"2026-01-01 17:30:34+00:00","SP BJS RAW PET FOOD",-293.25
2a909cda-044a-4b29-bb34-8fbe696b29a7,"2026-01-02 06:24:45+00:00","Amazon web services",-71.53
f81bc145-26ff-4e24-90c4-9b4f833f7a92,"2026-01-13 21:42:39+00:00","JUUL LABS, INC",5910.11
019c1142-ecb9-7bcb-be29-90197b791092,"2026-01-30 23:35:24+00:00","Fold Card Monthly Subscription Fee",-10.00
"Starting balance",6455.79
"Ending balance",1543.12
"Fees YTD",10.00
"Account Number","f349c2ab-985c-4494-907a-a3a0925dbdd6"
"In Case of Errors or Questions","..."
`

describe("parseFoldStatementCsv", () => {
  it("parses transactions and ignores metadata rows", () => {
    const result = parseFoldStatementCsv(FOLD_CSV_SAMPLE)
    expect(result.transactions).toHaveLength(4)
    expect(result.format).toBe("fold_csv")
  })

  it("maps negative amounts to expense type", () => {
    const result = parseFoldStatementCsv(FOLD_CSV_SAMPLE)
    const petFood = result.transactions.find(t => t.payee === "SP BJS RAW PET FOOD")
    expect(petFood).toBeDefined()
    expect(petFood!.type).toBe("expense")
    expect(petFood!.amount).toBeCloseTo(293.25)
  })

  it("maps positive amounts to credit type", () => {
    const result = parseFoldStatementCsv(FOLD_CSV_SAMPLE)
    const credit = result.transactions.find(t => t.payee === "JUUL LABS, INC")
    expect(credit).toBeDefined()
    expect(credit!.type).toBe("credit")
    expect(credit!.amount).toBeCloseTo(5910.11)
  })

  it("normalises dates to YYYY-MM-DD", () => {
    const result = parseFoldStatementCsv(FOLD_CSV_SAMPLE)
    for (const t of result.transactions) {
      expect(t.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it("sets envelopeName to Uncategorized for all rows", () => {
    const result = parseFoldStatementCsv(FOLD_CSV_SAMPLE)
    for (const t of result.transactions) {
      expect(t.envelopeName).toBe("Uncategorized")
    }
  })

  it("counts skipped rows", () => {
    const result = parseFoldStatementCsv(FOLD_CSV_SAMPLE)
    // The sample has 9 data lines (header excluded).
    // 4 are real transactions; 5 are metadata rows.
    expect(result.skippedRows).toBe(5)
    expect(result.totalRows).toBe(9)
  })

  it("throws for non-Fold CSV", () => {
    expect(() =>
      parseFoldStatementCsv("Date,Amount,Payee\n2026-01-01,-10.00,Starbucks"),
    ).toThrow(/Fold statement CSV/)
  })

  it("throws for empty file", () => {
    expect(() => parseFoldStatementCsv("")).toThrow(/empty/)
  })

  it("handles payees with commas", () => {
    const csv = `"Transaction ID","Settlement Date","Description","Amount"
abc12345-0000-0000-0000-000000000001,"2026-02-01 10:00:00+00:00","Motus,LLC",146.86
`
    const result = parseFoldStatementCsv(csv)
    expect(result.transactions[0]!.payee).toBe("Motus,LLC")
  })
})
