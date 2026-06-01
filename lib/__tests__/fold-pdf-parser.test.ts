import { describe, it, expect } from "vitest"
import { parsePdfAmount, parseFoldPdfText, isFoldStatementText } from "@/lib/fold-pdf-parser"

// ─── isFoldStatementText ─────────────────────────────────────────────────────

describe("isFoldStatementText", () => {
  it("returns true for canonical Fold PDF text", () => {
    const text = `Fold, Inc\nTransactions\nSettlement Date Amount Balance Merchant\n2026-01-02 04:59 ($293.25) $6,162.54 SP BJS`
    expect(isFoldStatementText(text)).toBe(true)
  })

  it("returns false when Transactions section is absent", () => {
    const text = `Settlement Date Amount Balance Merchant\n2026-01-02 04:59 ($293.25) $6,162.54 MERCHANT`
    expect(isFoldStatementText(text)).toBe(false)
  })

  it("returns false when column header is absent", () => {
    const text = `Fold, Inc\nTransactions\n2026-01-02 04:59 ($293.25) $6,162.54 MERCHANT`
    expect(isFoldStatementText(text)).toBe(false)
  })

  it("returns false for a generic receipt PDF", () => {
    const text = `RECEIPT\nTotal: $42.50\nThank you for shopping with us.`
    expect(isFoldStatementText(text)).toBe(false)
  })

  it("is case-insensitive for the column header", () => {
    const text = `Fold\nTransactions\nsettlement date amount balance merchant\n2026-01-01`
    expect(isFoldStatementText(text)).toBe(true)
  })
})

// ─── parsePdfAmount ───────────────────────────────────────────────────────────

describe("parsePdfAmount", () => {
  it("parses debit amount in parentheses", () => {
    expect(parsePdfAmount("($293.25)")).toBeCloseTo(-293.25)
  })

  it("parses credit amount without parentheses", () => {
    expect(parsePdfAmount("$5,910.11")).toBeCloseTo(5910.11)
  })

  it("parses zero", () => {
    expect(parsePdfAmount("$0.00")).toBe(0)
  })

  it("parses large debit with comma separators", () => {
    expect(parsePdfAmount("($8,000.00)")).toBeCloseTo(-8000)
  })

  it("returns null for non-amount string", () => {
    expect(parsePdfAmount("Settlement Date")).toBeNull()
    expect(parsePdfAmount("")).toBeNull()
  })
})

// ─── parseFoldPdfText ─────────────────────────────────────────────────────────

const SAMPLE_PDF_TEXT = `Fold, Inc
2942 North 24th Street Suite 115, #42035
Phoenix, Arizona 85016
www.foldapp.com
Account Number: 3614807784958
Andrew McMillion
Statement Summary
Opening balance $6,455.79
Total Credits $12,265.63
Total Debits ($17,178.30)
Ending balance $1,543.12
Statement Date 2026-05-27
Period Covered 01/01/2026-01/31/2026
Fees YTD ($10.00)
Transactions
Settlement Date Amount Balance Merchant
2026-01-02 04:59 ($293.25) $6,162.54 SP BJS RAW PET FOOD
2026-01-02 06:19 ($673.63) $5,488.91 FORTH
2026-01-13 21:42 $5,910.11 $10,690.44 JUUL LABS, INC
2026-01-26 09:45 ($127.76) $1,137.49 HOLY SMOKE & VAPE
SHOP -
Page 1/4

-- 1 of 4 --

2026-01-30 23:35 $0.00 $1,543.12 Fold Card Monthly
Subscription Fee
($10.00) Fold+ Subscription
Page 2/4

-- 2 of 4 --

Processed by:
SUTTON BANK
Legal text follows here...
`

describe("parseFoldPdfText", () => {
  it("extracts the correct number of transactions", () => {
    const result = parseFoldPdfText(SAMPLE_PDF_TEXT)
    expect(result.transactions).toHaveLength(5)
  })

  it("parses a debit transaction correctly", () => {
    const result = parseFoldPdfText(SAMPLE_PDF_TEXT)
    const petFood = result.transactions.find(t => t.payee.includes("SP BJS RAW PET FOOD"))
    expect(petFood).toBeDefined()
    expect(petFood!.type).toBe("expense")
    expect(petFood!.amount).toBeCloseTo(293.25)
    expect(petFood!.date).toBe("2026-01-02")
  })

  it("parses a credit transaction correctly", () => {
    const result = parseFoldPdfText(SAMPLE_PDF_TEXT)
    const credit = result.transactions.find(t => t.payee === "JUUL LABS, INC")
    expect(credit).toBeDefined()
    expect(credit!.type).toBe("credit")
    expect(credit!.amount).toBeCloseTo(5910.11)
  })

  it("concatenates multi-line merchant names", () => {
    const result = parseFoldPdfText(SAMPLE_PDF_TEXT)
    const shop = result.transactions.find(t => t.payee.includes("HOLY SMOKE"))
    expect(shop).toBeDefined()
    expect(shop!.payee).toBe("HOLY SMOKE & VAPE SHOP -")
  })

  it("handles the Fold subscription $0 fee pattern", () => {
    const result = parseFoldPdfText(SAMPLE_PDF_TEXT)
    const fee = result.transactions.find(t => t.payee.includes("Fold Card Monthly"))
    expect(fee).toBeDefined()
    expect(fee!.amount).toBeCloseTo(10)
    expect(fee!.type).toBe("expense")
    expect(fee!.payee).toContain("Subscription Fee")
  })

  it("ignores page markers and legal text", () => {
    const result = parseFoldPdfText(SAMPLE_PDF_TEXT)
    const pageLine = result.transactions.find(t => t.payee.includes("Page"))
    expect(pageLine).toBeUndefined()
    const legalLine = result.transactions.find(t => t.payee.includes("Processed by"))
    expect(legalLine).toBeUndefined()
  })

  it("sets envelopeName to Uncategorized for all rows", () => {
    const result = parseFoldPdfText(SAMPLE_PDF_TEXT)
    for (const t of result.transactions) {
      expect(t.envelopeName).toBe("Uncategorized")
    }
  })

  it("extracts metadata", () => {
    const result = parseFoldPdfText(SAMPLE_PDF_TEXT)
    expect(result.meta.accountNumber).toBe("3614807784958")
    expect(result.meta.periodStart).toBe("2026-01-01")
    expect(result.meta.periodEnd).toBe("2026-01-31")
  })

  it("returns empty transactions for text with no Transactions section", () => {
    const result = parseFoldPdfText("Some random text without a transactions section.")
    expect(result.transactions).toHaveLength(0)
  })

  it("normalises dates to YYYY-MM-DD", () => {
    const result = parseFoldPdfText(SAMPLE_PDF_TEXT)
    for (const t of result.transactions) {
      expect(t.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})
