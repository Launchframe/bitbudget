import { describe, expect, it } from "vitest"
import {
  dateInputValueFromTransactionDate,
  formatTransactionDetailDateTime,
  formatTransactionTableDate,
  isCalendarDateOnly,
  mergeCalendarDayIntoTransactionDate,
  parseTransactionDateInput,
  serializeTransactionDateForClient,
  transactionCalendarDay,
  transactionDateFromDb,
  receiptCapturePrefillDate,
} from "../transaction-dates"

describe("transaction-dates", () => {
  it("isCalendarDateOnly distinguishes calendar vs timestamp strings", () => {
    expect(isCalendarDateOnly("2026-05-14")).toBe(true)
    expect(isCalendarDateOnly("2026-05-14T16:54:53.000Z")).toBe(false)
  })

  it("parseTransactionDateInput uses UTC midnight for calendar days", () => {
    const d = parseTransactionDateInput("2026-05-14")
    expect(d?.toISOString()).toBe("2026-05-14T00:00:00.000Z")
  })

  it("parseTransactionDateInput preserves instants for ISO timestamps", () => {
    const d = parseTransactionDateInput("2026-05-14T16:54:53.000Z")
    expect(d?.toISOString()).toBe("2026-05-14T16:54:53.000Z")
  })

  it("serializeTransactionDateForClient drops midnight UTC to YYYY-MM-DD", () => {
    expect(serializeTransactionDateForClient(new Date("2026-05-14T00:00:00.000Z"))).toBe(
      "2026-05-14",
    )
    expect(
      serializeTransactionDateForClient(new Date("2026-05-14T16:54:53.000Z")),
    ).toBe("2026-05-14T16:54:53.000Z")
  })

  it("transactionDateFromDb matches serialize helper", () => {
    expect(transactionDateFromDb(new Date("2026-05-14T12:00:00.000Z"))).toBe(
      "2026-05-14T12:00:00.000Z",
    )
  })

  it("formatTransactionTableDate uses calendar day for UTC-midnight storage", () => {
    const label = formatTransactionTableDate("2026-05-14")
    expect(label).toContain("May")
    expect(label).toContain("14")
    expect(label).toContain("2026")
  })

  it("formatTransactionTableDate matches calendar day for afternoon UTC timestamps", () => {
    const morningUtc = formatTransactionTableDate("2026-05-14T16:54:53.000Z")
    expect(morningUtc).toContain("May")
    expect(morningUtc).toContain("14")
  })

  it("formatTransactionDetailDateTime includes time for timestamps", () => {
    const label = formatTransactionDetailDateTime("2026-05-14T16:54:53.000Z")
    expect(label).toMatch(/\d/)
    expect(label.toLowerCase()).not.toBe("invalid date")
  })

  it("mergeCalendarDayIntoTransactionDate updates local calendar day", () => {
    const merged = mergeCalendarDayIntoTransactionDate(
      "2026-05-14T16:54:53.000Z",
      "2026-05-15",
    )
    expect(transactionCalendarDay(merged)).toBe("2026-05-15")
    expect(merged).toContain("T")
  })

  it("dateInputValueFromTransactionDate returns local calendar day", () => {
    expect(dateInputValueFromTransactionDate("2026-05-14T23:30:00.000Z")).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    )
  })

  it("receiptCapturePrefillDate applies OCR calendar day to capture instant", () => {
    const noonLocal = new Date(2026, 4, 14, 12, 54, 53).getTime()
    const iso = receiptCapturePrefillDate("2026-05-14", noonLocal)
    expect(transactionCalendarDay(iso)).toBe("2026-05-14")
    expect(isCalendarDateOnly(iso)).toBe(false)
  })
})
