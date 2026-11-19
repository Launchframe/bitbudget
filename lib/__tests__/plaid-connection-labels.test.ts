import { describe, expect, it } from "vitest"
import {
  formatPlaidAccountBalance,
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

describe("formatPlaidAccountBalance", () => {
  it("shows a checking balance as dollars", () => {
    expect(
      formatPlaidAccountBalance({
        accountName: "Checking",
        mask: "1234",
        type: "depository",
        currentBalance: 1240.5,
        isoCurrencyCode: "USD",
      }),
    ).toBe("$1,240.50")
  })

  it("shows available checking cash when Plaid sent it", () => {
    expect(
      formatPlaidAccountBalance({
        accountName: "Checking",
        mask: "1234",
        type: "depository",
        currentBalance: 2000,
        availableBalance: 1800,
        isoCurrencyCode: "USD",
      }),
    ).toBe("$1,800.00")
  })

  it("shows a credit card as an amount owed", () => {
    expect(
      formatPlaidAccountBalance({
        accountName: "Sapphire",
        mask: "9999",
        type: "credit",
        currentBalance: 320,
        isoCurrencyCode: "USD",
      }),
    ).toBe("$320.00 owed")
  })

  it("shows a negative credit balance as a credit on the card", () => {
    expect(
      formatPlaidAccountBalance({
        accountName: "Sapphire",
        mask: "9999",
        type: "credit",
        currentBalance: -50,
        isoCurrencyCode: "USD",
      }),
    ).toBe("$50.00 credit")
  })

  it("returns null until a balance exists", () => {
    expect(
      formatPlaidAccountBalance({
        accountName: "Checking",
        mask: null,
        type: "depository",
        currentBalance: null,
      }),
    ).toBeNull()
  })
})

describe("formatPlaidInstitutionTitle", () => {
  it("falls back for missing name", () => {
    expect(formatPlaidInstitutionTitle(null)).toBe("Connected bank")
  })
})
