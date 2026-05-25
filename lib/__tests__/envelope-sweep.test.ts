// @vitest-environment node
import { describe, expect, it } from "vitest"
import { Prisma } from "@prisma/client"
import {
  monthProgressMarkerPct,
  resolveSweepCapMultiplier,
  suggestedManualSweepAmount,
  sweepAmountForEnvelope,
} from "../sweep-math"
import { sweepFromLabel } from "../envelope-sweep"
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

  it("sweepAmountForEnvelope reset keeps up to 1.0× allotment (same as capped at 1.0)", () => {
    expect(
      sweepAmountForEnvelope({
        balance: 42.5,
        policy: SWEEP_POLICY_RESET,
        monthlyAllotment: 100,
        capMultiplier: 1.5,
      }),
    ).toBe(0)
    expect(
      sweepAmountForEnvelope({
        balance: 150,
        policy: SWEEP_POLICY_RESET,
        monthlyAllotment: 100,
        capMultiplier: 1.5,
      }),
    ).toBe(50)
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

  it("sweepAmountForEnvelope skips reset/capped when monthly allotment is unset", () => {
    expect(
      sweepAmountForEnvelope({
        balance: 100,
        policy: SWEEP_POLICY_RESET,
        monthlyAllotment: 0,
        capMultiplier: 1.5,
      }),
    ).toBe(0)
    expect(
      sweepAmountForEnvelope({
        balance: 100,
        policy: SWEEP_POLICY_CAPPED,
        monthlyAllotment: 0,
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

  it("monthProgressMarkerPct is 100 on first day and 0 on last day of month", () => {
    expect(monthProgressMarkerPct(new Date(2026, 4, 1))).toBe(100)
    expect(monthProgressMarkerPct(new Date(2026, 4, 31))).toBe(0)
  })

  it("suggestedManualSweepAmount reset aligns surplus above month pace", () => {
    const midMonth = new Date(2026, 4, 16)
    expect(
      suggestedManualSweepAmount({
        balance: 80,
        policy: SWEEP_POLICY_RESET,
        monthlyAllotment: 100,
        capMultiplier: 1.5,
        asOf: midMonth,
      }),
    ).toBeGreaterThan(0)
    expect(
      suggestedManualSweepAmount({
        balance: 40,
        policy: SWEEP_POLICY_RESET,
        monthlyAllotment: 100,
        capMultiplier: 1.5,
        asOf: midMonth,
      }),
    ).toBe(0)
  })

  it("suggestedManualSweepAmount carry_forward sweeps above monthly allotment", () => {
    expect(
      suggestedManualSweepAmount({
        balance: 150,
        policy: SWEEP_POLICY_CARRY_FORWARD,
        monthlyAllotment: 100,
        capMultiplier: 1.5,
      }),
    ).toBe(50)
    expect(
      suggestedManualSweepAmount({
        balance: 80,
        policy: SWEEP_POLICY_CARRY_FORWARD,
        monthlyAllotment: 100,
        capMultiplier: 1.5,
      }),
    ).toBe(0)
  })

  it("suggestedManualSweepAmount capped matches sweepAmountForEnvelope", () => {
    expect(
      suggestedManualSweepAmount({
        balance: 200,
        policy: SWEEP_POLICY_CAPPED,
        monthlyAllotment: 100,
        capMultiplier: 1.5,
      }),
    ).toBe(50)
  })
})
