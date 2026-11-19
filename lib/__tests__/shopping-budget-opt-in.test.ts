// @vitest-environment node
import { describe, expect, it } from "vitest"
import { encryptFieldAsymmetric, generateKeyPairFromSeed } from "@/lib/crypto"
import {
  budgetEnvelopeUnavailable,
  budgetOptInSequence,
  budgetPayeeReady,
  budgetPostingSkipped,
  eventAllowedByBudgetOptIn,
  missingAdvanceEventIdsFromPostings,
} from "../shopping-budget-projection"

describe("budget opt-in window", () => {
  it("opens at the next group event the first time budgeting is on", () => {
    expect(budgetOptInSequence({
      enabled: true,
      catchUpApproved: false,
      previouslyEnabled: false,
      previousCatchUpApproved: false,
      previousEnabledAtSequence: null,
      groupEventSequence: 40,
    })).toBe(41)
  })

  it("keeps the current point when the envelope changes", () => {
    expect(budgetOptInSequence({
      enabled: true,
      catchUpApproved: false,
      previouslyEnabled: true,
      previousCatchUpApproved: false,
      previousEnabledAtSequence: 4,
      groupEventSequence: 40,
    })).toBe(4)
  })

  it("moves forward when catch-up is turned off", () => {
    expect(budgetOptInSequence({
      enabled: true,
      catchUpApproved: false,
      previouslyEnabled: true,
      previousCatchUpApproved: true,
      previousEnabledAtSequence: 4,
      groupEventSequence: 40,
    })).toBe(41)
  })

  it("keeps the stored point while catch-up stays on or budgeting is off", () => {
    expect(budgetOptInSequence({
      enabled: true,
      catchUpApproved: true,
      previouslyEnabled: true,
      previousCatchUpApproved: false,
      previousEnabledAtSequence: 4,
      groupEventSequence: 40,
    })).toBe(4)
    expect(budgetOptInSequence({
      enabled: false,
      catchUpApproved: false,
      previouslyEnabled: true,
      previousCatchUpApproved: true,
      previousEnabledAtSequence: 4,
      groupEventSequence: 40,
    })).toBe(4)
  })

  it("allows every event during catch-up and only later events otherwise", () => {
    expect(eventAllowedByBudgetOptIn({
      catchUpApproved: true,
      enabledAtSequence: null,
      eventSequence: 1,
    })).toBe(true)
    expect(eventAllowedByBudgetOptIn({
      catchUpApproved: false,
      enabledAtSequence: null,
      eventSequence: 3,
    })).toBe(false)
    expect(eventAllowedByBudgetOptIn({
      catchUpApproved: false,
      enabledAtSequence: 5,
      eventSequence: 4,
    })).toBe(false)
    expect(eventAllowedByBudgetOptIn({
      catchUpApproved: false,
      enabledAtSequence: 5,
      eventSequence: 5,
    })).toBe(true)
  })
})

describe("budget posting helpers", () => {
  it("reads skipped cover rows back to their receipt", () => {
    const ids = missingAdvanceEventIdsFromPostings([
      { entryKey: "e1:advance_out:memberB", status: "skipped" },
      { entryKey: "e2:advance_out:memberB", status: "posted" },
      { entryKey: "e3:own_expense", status: "suppressed" },
      { entryKey: "e4:advance_out:memberC", status: "suppressed" },
    ])
    expect([...ids].sort()).toEqual(["e1", "e4"])
  })

  it("accepts only sealed payee text", () => {
    const sealed = encryptFieldAsymmetric(
      "Market",
      generateKeyPairFromSeed(new Uint8Array(32).fill(3)).publicKey,
    )
    expect(budgetPayeeReady(sealed)).toBe(true)
    expect(budgetPayeeReady("Market")).toBe(false)
    expect(budgetPayeeReady("")).toBe(false)
  })

  it("notices a missing envelope and an already skipped row", () => {
    expect(budgetEnvelopeUnavailable({ needsAttention: ["k1"] })).toBe(true)
    expect(budgetEnvelopeUnavailable({ needsAttention: [] })).toBe(false)
    expect(budgetEnvelopeUnavailable({})).toBe(false)
    expect(budgetPostingSkipped({ skipped: ["k1"] })).toBe(true)
    expect(budgetPostingSkipped({ skipped: [] })).toBe(false)
  })
})
