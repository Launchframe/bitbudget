import { describe, expect, it } from "vitest"
import { composeBankAlertText } from "@/lib/bank-alert-parser"

describe("composeBankAlertText", () => {
  it("prefers explicit text", () => {
    expect(
      composeBankAlertText({ text: "full", title: "t", body: "b" }),
    ).toBe("full")
  })

  it("joins title and body", () => {
    expect(composeBankAlertText({ title: "Debit", body: "$1.00" })).toBe("Debit\n$1.00")
  })

  it("returns null when empty", () => {
    expect(composeBankAlertText({})).toBeNull()
  })
})
