import { describe, expect, it } from "vitest"
import {
  formatPlaidAccountLabel,
  formatPlaidInstitutionTitle,
  plaidConnectSuccessMessage,
} from "@/lib/plaid-connection-labels"

describe("plaidConnectSuccessMessage", () => {
  it("uses singular copy for one account", () => {
    expect(plaidConnectSuccessMessage("Chase", 1)).toBe(
      "Your Chase account was successfully connected!",
    )
  })

  it("uses plural copy for multiple accounts", () => {
    expect(plaidConnectSuccessMessage("Chase", 2)).toBe(
      "Your Chase accounts were successfully connected!",
    )
  })

  it("falls back when institution name is empty", () => {
    expect(plaidConnectSuccessMessage("", 1)).toBe(
      "Your bank account was successfully connected!",
    )
  })
})

describe("formatPlaidAccountLabel", () => {
  it("includes mask when present", () => {
    expect(
      formatPlaidAccountLabel({
        accountName: "Checking",
        mask: "1234",
        type: "depository",
      }),
    ).toBe("Checking ••1234")
  })
})

describe("formatPlaidInstitutionTitle", () => {
  it("falls back for missing name", () => {
    expect(formatPlaidInstitutionTitle(null)).toBe("Connected bank")
  })
})
