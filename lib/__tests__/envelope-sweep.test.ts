// @vitest-environment node
import { describe, expect, it } from "vitest"
import { Prisma } from "@prisma/client"
import {
  resolveSweepCapMultiplier,
  sweepAmountForEnvelope,
  sweepFromLabel,
} from "../envelope-sweep"
import {
  SWEEP_POLICY_CAPPED,
  SWEEP_POLICY_CARRY_FORWARD,
  SWEEP_POLICY_RESET,
} from "../constants"

describe("envelope-sweep", () => {
  it("sweepFromLabel includes envelope name", () => {
    expect(sweepFromLabel("Groceries")).toBe("Swept from Groceries")
  })

  it("resolveSweepCapMultiplier prefers envelope then user default then 1.5", () => {
    expect(resolveSweepCapMultiplier(null, null)).toBe(1.5)
    expect(resolveSweepCapMultiplier(new Prisma.Decimal(2), null)).toBe(2)
    expect(resolveSweepCapMultiplier(null, new Prisma.Decimal(1.25))).toBe(1.25)
  })

  it("sweepAmountForEnvelope reset sweeps full positive balance", () => {
    expect(
      sweepAmountForEnvelope({
        balance: 42.5,
        policy: SWEEP_POLICY_RESET,
        monthlyAllotment: 100,
        capMultiplier: 1.5,
      }),
    ).toBe(42.5)
  })

  it("sweepAmountForEnvelope carry_forward skips", () => {
    expect(
      sweepAmountForEnvelope({
        balance: 42.5,
        policy: SWEEP_POLICY_CARRY_FORWARD,
        monthlyAllotment: 100,
        capMultiplier: 1.5,
      }),
    ).toBe(0)
  })

  it("sweepAmountForEnvelope capped sweeps only above cap × allotment", () => {
    expect(
      sweepAmountForEnvelope({
        balance: 200,
        policy: SWEEP_POLICY_CAPPED,
        monthlyAllotment: 100,
        capMultiplier: 1.5,
      }),
    ).toBe(50)
    expect(
      sweepAmountForEnvelope({
        balance: 120,
        policy: SWEEP_POLICY_CAPPED,
        monthlyAllotment: 100,
        capMultiplier: 1.5,
      }),
    ).toBe(0)
  })

  it("sweepAmountForEnvelope skips non-positive balances", () => {
    expect(
      sweepAmountForEnvelope({
        balance: 0,
        policy: SWEEP_POLICY_RESET,
        monthlyAllotment: 100,
        capMultiplier: 1.5,
      }),
    ).toBe(0)
    expect(
      sweepAmountForEnvelope({
        balance: -5,
        policy: SWEEP_POLICY_RESET,
        monthlyAllotment: 100,
        capMultiplier: 1.5,
      }),
    ).toBe(0)
  })
})
