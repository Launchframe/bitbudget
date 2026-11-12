import { describe, expect, it } from "vitest"
import {
  depositoryCashUsd,
  plaidAmountToLedger,
  snapshotFromPlaidAccount,
} from "@/lib/plaid-ledger"

describe("plaidAmountToLedger", () => {
  it("treats a positive Plaid amount as money out", () => {
    expect(plaidAmountToLedger(42.5)).toEqual({ type: "expense", amount: 42.5 })
  })

  it("treats a negative Plaid amount as money in", () => {
    expect(plaidAmountToLedger(-1800)).toEqual({ type: "credit", amount: 1800 })
  })

  it("skips zero and non-finite amounts", () => {
    expect(plaidAmountToLedger(0)).toBeNull()
    expect(plaidAmountToLedger(Number.NaN)).toBeNull()
  })
})

describe("snapshotFromPlaidAccount", () => {
  it("keeps current and available balances", () => {
    expect(
      snapshotFromPlaidAccount({
        account_id: "acc_1",
        name: "Checking",
        mask: "1234",
        type: "depository",
        balances: { current: 1500.25, available: 1400, iso_currency_code: "USD" },
      }),
    ).toEqual({
      accountId: "acc_1",
      name: "Checking",
      mask: "1234",
      type: "depository",
      balances: { current: 1500.25, available: 1400, isoCurrencyCode: "USD" },
    })
  })

  it("drops a snapshot with no account id", () => {
    expect(snapshotFromPlaidAccount({ name: "Checking" })).toBeNull()
  })
})

describe("depositoryCashUsd", () => {
  it("sums available checking and savings and skips credit cards", () => {
    expect(
      depositoryCashUsd([
        {
          type: "depository",
          currentBalance: 2000,
          availableBalance: 1800,
          isoCurrencyCode: "USD",
        },
        {
          type: "depository",
          currentBalance: 500,
          availableBalance: null,
          isoCurrencyCode: null,
        },
        {
          type: "credit",
          currentBalance: 320,
          availableBalance: 4680,
          isoCurrencyCode: "USD",
        },
      ]),
    ).toBe(2300)
  })

  it("returns null when no depository balance is known", () => {
    expect(
      depositoryCashUsd([
        {
          type: "credit",
          currentBalance: 10,
          availableBalance: null,
          isoCurrencyCode: "USD",
        },
      ]),
    ).toBeNull()
  })
})
