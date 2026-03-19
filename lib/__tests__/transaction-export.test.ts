// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  escapeCsvField,
  buildExportFilename,
  buildTransactionsCsv,
  type TransactionExportRow,
} from "../transaction-export"

describe("escapeCsvField", () => {
  it("returns value as-is when it contains no comma, newline, or double quote", () => {
    expect(escapeCsvField("Trader Joe's")).toBe("Trader Joe's")
    expect(escapeCsvField("")).toBe("")
    expect(escapeCsvField("expense")).toBe("expense")
  })

  it("wraps in double quotes and doubles internal quotes when value contains comma", () => {
    expect(escapeCsvField("Acme, Inc.")).toBe('"Acme, Inc."')
  })

  it("wraps in double quotes when value contains newline", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"')
  })

  it("escapes double quotes by doubling them", () => {
    expect(escapeCsvField('Say "hello"')).toBe('"Say ""hello"""')
  })

  it("handles mixed comma and quote", () => {
    expect(escapeCsvField('"Acme", Inc.')).toBe('"""Acme"", Inc."')
  })
})

describe("buildExportFilename", () => {
  it("returns base name with date stamp when no filters", () => {
    expect(buildExportFilename({ stampDate: "2026-02-28" })).toBe(
      "bitbudget-transactions-2026-02-28.csv"
    )
  })

  it("appends -payee-search when hasPayeeSearch is true", () => {
    expect(
      buildExportFilename({ stampDate: "2026-02-28", hasPayeeSearch: true })
    ).toBe("bitbudget-transactions-2026-02-28-payee-search.csv")
  })

  it("appends type filter when set", () => {
    expect(
      buildExportFilename({ stampDate: "2026-02-28", typeFilter: "expense" })
    ).toBe("bitbudget-transactions-2026-02-28-expense.csv")
    expect(
      buildExportFilename({ stampDate: "2026-02-28", typeFilter: "credit" })
    ).toBe("bitbudget-transactions-2026-02-28-credit.csv")
  })

  it("appends envelope names when provided", () => {
    expect(
      buildExportFilename({
        stampDate: "2026-02-28",
        envelopeNames: ["Groceries"],
      })
    ).toBe("bitbudget-transactions-2026-02-28-envelope-Groceries.csv")
    expect(
      buildExportFilename({
        stampDate: "2026-02-28",
        envelopeNames: ["Rent", "Food"],
      })
    ).toBe("bitbudget-transactions-2026-02-28-envelope-Rent-Food.csv")
  })

  it("sanitizes envelope names for filename (non-alphanumeric to hyphen)", () => {
    expect(
      buildExportFilename({
        stampDate: "2026-02-28",
        envelopeNames: ["My Envelope!"],
      })
    ).toBe("bitbudget-transactions-2026-02-28-envelope-My-Envelope.csv")
  })

  it("appends tag names when provided", () => {
    expect(
      buildExportFilename({
        stampDate: "2026-02-28",
        tagNames: ["work", "reimbursable"],
      })
    ).toBe("bitbudget-transactions-2026-02-28-tags-work-reimbursable.csv")
  })

  it("appends date range when provided", () => {
    expect(
      buildExportFilename({
        stampDate: "2026-02-28",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      })
    ).toBe(
      "bitbudget-transactions-2026-02-28-from-2026-01-01-to-2026-01-31.csv"
    )
  })

  it("combines multiple descriptors", () => {
    expect(
      buildExportFilename({
        stampDate: "2026-02-28",
        hasPayeeSearch: true,
        typeFilter: "expense",
        envelopeNames: ["Groceries"],
        startDate: "2026-01-01",
      })
    ).toBe(
      "bitbudget-transactions-2026-02-28-payee-search-expense-envelope-Groceries-from-2026-01-01.csv"
    )
  })

  it("ignores empty envelope or tag arrays", () => {
    expect(
      buildExportFilename({
        stampDate: "2026-02-28",
        envelopeNames: [],
        tagNames: [],
      })
    ).toBe("bitbudget-transactions-2026-02-28.csv")
  })
})

describe("buildTransactionsCsv", () => {
  it("returns only header when no rows", () => {
    expect(buildTransactionsCsv([])).toBe(
      "type,date,payee,amount,notes,envelope,tags"
    )
  })

  it("formats a single row with simple values", () => {
    const rows: TransactionExportRow[] = [
      {
        type: "expense",
        date: "2026-02-15",
        payee: "Trader Joe's",
        amountFormatted: "$42.50",
        notes: "",
        envelopeName: "Groceries",
        tags: "",
      },
    ]
    expect(buildTransactionsCsv(rows)).toBe(
      "type,date,payee,amount,notes,envelope,tags\nexpense,2026-02-15,Trader Joe's,$42.50,,Groceries,"
    )
  })

  it("escapes payee and notes containing commas", () => {
    const rows: TransactionExportRow[] = [
      {
        type: "expense",
        date: "2026-02-15",
        payee: "Acme, Inc.",
        amountFormatted: "$100.00",
        notes: "Note, with comma",
        envelopeName: "Rent",
        tags: "",
      },
    ]
    const csv = buildTransactionsCsv(rows)
    expect(csv).toContain('"Acme, Inc."')
    expect(csv).toContain('"Note, with comma"')
  })

  it("escapes amount when it contains comma (e.g. thousands)", () => {
    const rows: TransactionExportRow[] = [
      {
        type: "expense",
        date: "2026-02-15",
        payee: "Landlord",
        amountFormatted: "$1,234.56",
        notes: "",
        envelopeName: "Rent",
        tags: "",
      },
    ]
    expect(buildTransactionsCsv(rows)).toContain('"$1,234.56"')
  })

  it("escapes double quotes in fields", () => {
    const rows: TransactionExportRow[] = [
      {
        type: "expense",
        date: "2026-02-15",
        payee: 'Say "hello"',
        amountFormatted: "$10.00",
        notes: "",
        envelopeName: "Other",
        tags: "",
      },
    ]
    expect(buildTransactionsCsv(rows)).toContain('"Say ""hello"""')
  })

  it("formats multiple rows", () => {
    const rows: TransactionExportRow[] = [
      {
        type: "expense",
        date: "2026-02-15",
        payee: "Store A",
        amountFormatted: "$20.00",
        notes: "",
        envelopeName: "Groceries",
        tags: "food",
      },
      {
        type: "credit",
        date: "2026-02-14",
        payee: "Refund",
        amountFormatted: "$5.00",
        notes: "",
        envelopeName: "Groceries",
        tags: "",
      },
    ]
    const csv = buildTransactionsCsv(rows)
    expect(csv.split("\n").length).toBe(3)
    expect(csv).toContain("expense,2026-02-15,")
    expect(csv).toContain("credit,2026-02-14,")
    expect(csv).toContain("food")
  })
})
