import { describe, it, expect } from "vitest"
import {
  parseFoldDate,
  isFoldStatementCsv,
  parseFoldStatementCsv,
  ignoredTradesMessage,
  parseChaseStatementCsv,
  parseCoinbaseHistoryCsv,
  tryParseStatementCsv,
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

const CHASE_CSV = `Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #
DEBIT,01/15/2024,STARBUCKS,-4.50,DEBIT,100.00,
CREDIT,01/16/2024,PAYROLL,2000.00,CREDIT,2100.00,
DEBIT,01/17/2024,RENT,1500.00,DEBIT,600.00,
`

describe("parseChaseStatementCsv", () => {
  it("reads debits as expenses and credits as money in", () => {
    const result = parseChaseStatementCsv(CHASE_CSV)
    expect(result.format).toBe("chase_csv")
    expect(result.institutionName).toBe("Chase")
    expect(result.transactions).toEqual([
      expect.objectContaining({ payee: "STARBUCKS", type: "expense", amount: 4.5, date: "2024-01-15" }),
      expect.objectContaining({ payee: "PAYROLL", type: "credit", amount: 2000, date: "2024-01-16" }),
      expect.objectContaining({ payee: "RENT", type: "expense", amount: 1500, date: "2024-01-17" }),
    ])
  })

  it("reads ACH debits, ACH credits, and paid checks from a Chase download", () => {
    const csv = `Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #
DEBIT,01/16/2026,"NORTHWIND COFFEE",-6.45,DEBIT_CARD,2843.55,
CREDIT,01/15/2026,"CONTOSO LTD PAYROLL",2150.00,ACH_CREDIT,2850.00,
DEBIT,01/13/2026,"FABRIKAM ELECTRIC",-112.30,ACH_DEBIT,700.00,
CHECK,01/12/2026,"CHECK 1043",-250.00,CHECK_PAID,812.30,1043
`
    const result = parseChaseStatementCsv(`\uFEFF${csv}`)
    expect(result.transactions.map((row) => [row.payee, row.type, row.amount])).toEqual([
      ["NORTHWIND COFFEE", "expense", 6.45],
      ["CONTOSO LTD PAYROLL", "credit", 2150],
      ["FABRIKAM ELECTRIC", "expense", 112.3],
      ["CHECK 1043", "expense", 250],
    ])
  })
})

const COINBASE_CSV = `Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Notes
2024-03-01 16:22:11 UTC,Deposit,USD,500,USD,1,500,500,Bank
2024-03-02 12:00:00 UTC,Buy,BTC,0.01,USD,50000,500,502,Bought bitcoin
2024-03-03 12:00:00 UTC,Withdrawal,USD,100,USD,1,100,100,To checking
`

describe("parseCoinbaseHistoryCsv", () => {
  it("imports USD deposits and withdrawals and skips bitcoin buys", () => {
    const result = parseCoinbaseHistoryCsv(COINBASE_CSV)
    expect(result.format).toBe("coinbase_csv")
    expect(result.institutionName).toBe("Coinbase")
    expect(result.ignoredTrades).toBe(1)
    expect(result.transactions).toEqual([
      expect.objectContaining({ type: "credit", amount: 500, payee: "Bank" }),
      expect.objectContaining({ type: "expense", amount: 100, payee: "To checking" }),
    ])
  })

  it("finds the header under the preamble and does not import the account line", () => {
    const text = `Transactions\nuser@example.com,hidden-id\n${COINBASE_CSV}`
    const result = parseCoinbaseHistoryCsv(text)
    expect(result.transactions).toHaveLength(2)
    expect(result.ignoredTrades).toBe(1)
    expect(result.transactions.some((row) => row.payee.includes("@"))).toBe(false)
    expect(ignoredTradesMessage(result.ignoredTrades ?? 0)).toMatch(/left out/)
  })
})

describe("tryParseStatementCsv formats", () => {
  it("picks Chase and Coinbase without treating them as Fold", () => {
    expect(tryParseStatementCsv(CHASE_CSV)?.format).toBe("chase_csv")
    expect(tryParseStatementCsv(COINBASE_CSV)?.format).toBe("coinbase_csv")
  })
})
