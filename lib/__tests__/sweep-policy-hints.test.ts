import { describe, expect, it } from "vitest"
import {
  SWEEP_POLICY_CAPPED,
  SWEEP_POLICY_CARRY_FORWARD,
  SWEEP_POLICY_RESET,
} from "@/lib/constants"
import {
  buildSweepPolicyHint,
  pickSweepExampleEnvelope,
} from "../sweep-policy-hints"

describe("pickSweepExampleEnvelope", () => {
  const envelopes = [
    { id: "a", name: "Groceries", monthlyAllotment: 400 },
    { id: "b", name: "Fun", monthlyAllotment: 100 },
  ]

  it("prefers the envelope with the highest positive balance", () => {
    const picked = pickSweepExampleEnvelope(envelopes, (id) => (id === "a" ? 25 : 80))
    expect(picked?.name).toBe("Fun")
    expect(picked?.balance).toBe(80)
  })

  it("falls back to largest allotment when no positive balance", () => {
    const picked = pickSweepExampleEnvelope(envelopes, () => 0)
    expect(picked?.name).toBe("Groceries")
    expect(picked?.balance).toBe(0)
  })
})

describe("buildSweepPolicyHint", () => {
  const example = {
    id: "a",
    name: "Groceries",
    balance: 120,
    monthlyAllotment: 400,
  }

  it("describes reset as allotment cap with no sweep below allocation", () => {
    const hint = buildSweepPolicyHint({
      policy: SWEEP_POLICY_RESET,
      capMultiplier: 1.5,
      example,
    })
    expect(hint.description).toMatch(/1st of each month/i)
    expect(hint.example).toContain("Groceries")
    expect(hint.example).toMatch(/nothing sweeps/i)
  })

  it("describes reset sweeping surplus above allocation", () => {
    const hint = buildSweepPolicyHint({
      policy: SWEEP_POLICY_RESET,
      capMultiplier: 1.5,
      example: { ...example, balance: 500 },
    })
    expect(hint.example).toContain("$500")
    expect(hint.example).toMatch(/sweeps to Savings/i)
    expect(hint.example).toContain("$100")
  })

  it("describes carry forward with a concrete example", () => {
    const hint = buildSweepPolicyHint({
      policy: SWEEP_POLICY_CARRY_FORWARD,
      capMultiplier: 1.5,
      example,
    })
    expect(hint.example).toMatch(/nothing moves/i)
    expect(hint.example).toContain("$120")
  })

  it("describes capped surplus using cap math", () => {
    const hint = buildSweepPolicyHint({
      policy: SWEEP_POLICY_CAPPED,
      capMultiplier: 1.5,
      example: { ...example, balance: 700 },
    })
    expect(hint.example).toContain("$700")
    expect(hint.example).toMatch(/sweeps to Savings/i)
    expect(hint.example).toContain("$600")
  })
})
