import { describe, expect, it } from "vitest"
import {
  parseTransactionQueryCalendarDate,
  utcEndOfCalendarDay,
} from "../transaction-query-dates"

describe("transaction-query-dates", () => {
  it("parseTransactionQueryCalendarDate accepts valid UTC days", () => {
    const d = parseTransactionQueryCalendarDate("2025-06-15")
    expect(d).not.toBeNull()
    expect(d!.toISOString().startsWith("2025-06-15T")).toBe(true)
  })

  it("rejects non YYYY-MM-DD", () => {
    expect(parseTransactionQueryCalendarDate("2025-6-15")).toBeNull()
    expect(parseTransactionQueryCalendarDate("06-15-2025")).toBeNull()
    expect(parseTransactionQueryCalendarDate("2025-06-15T00:00:00.000Z")).toBeNull()
    expect(parseTransactionQueryCalendarDate("")).toBeNull()
  })

  it("rejects invalid calendar days", () => {
    expect(parseTransactionQueryCalendarDate("2025-02-30")).toBeNull()
    expect(parseTransactionQueryCalendarDate("2025-13-01")).toBeNull()
  })

  it("utcEndOfCalendarDay returns end of UTC day", () => {
    const end = utcEndOfCalendarDay("2025-01-01")
    expect(end).not.toBeNull()
    expect(end!.toISOString()).toBe("2025-01-01T23:59:59.999Z")
  })
})
