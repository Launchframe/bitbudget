import { describe, expect, it } from "vitest"
import type { AccountRule } from "@/lib/account-rules"
import {
  calculateRoundUpCents,
  evaluateRules,
  getRedactedPayee,
  getSavingsFloorAmount,
  hasRoundUpRule,
  mergeRuleMutations,
} from "@/lib/rule-engine-client"

function rule(
  partial: Partial<AccountRule> & Pick<AccountRule, "id" | "type" | "trigger">,
): AccountRule {
  return {
    userId: "user-1",
    priority: 0,
    enabled: true,
    conditions: [],
    actions: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...partial,
  }
}

describe("evaluateRules", () => {
  it("returns no mutations when no rules match", () => {
    const rules = [
      rule({
        id: "r1",
        type: "skip",
        trigger: "on_import",
        conditions: [{ field: "payee", op: "contains", value: "TRANSFER" }],
        actions: [{ type: "exclude", params: {} }],
      }),
    ]
    expect(evaluateRules("on_import", { payee: "Starbucks" }, rules)).toEqual([])
  })

  it("skips disabled rules", () => {
    const rules = [
      rule({
        id: "r1",
        type: "skip",
        trigger: "on_import",
        enabled: false,
        conditions: [{ field: "payee", op: "contains", value: "ZELLE" }],
        actions: [{ type: "exclude", params: {} }],
      }),
    ]
    expect(evaluateRules("on_import", { payee: "ZELLE PAYMENT" }, rules)).toEqual([])
  })

  it("matches on_import rules when trigger is on_scan", () => {
    const rules = [
      rule({
        id: "r1",
        type: "skip",
        trigger: "on_import",
        conditions: [{ field: "payee", op: "contains", value: "transfer" }],
        actions: [{ type: "exclude", params: {} }],
      }),
    ]
    const mutations = evaluateRules("on_scan", { payee: "ACH TRANSFER OUT" }, rules)
    expect(mutations).toHaveLength(1)
    expect(mutations[0]?.exclude).toBe(true)
  })

  it("evaluates conditions case-insensitively for payee contains", () => {
    const rules = [
      rule({
        id: "r1",
        type: "auto_categorize",
        trigger: "on_import",
        conditions: [{ field: "payee", op: "contains", value: "netflix" }],
        actions: [{ type: "set_envelope", params: { envelopeId: "env-streaming" } }],
      }),
    ]
    const mutations = evaluateRules("on_import", { payee: "NETFLIX.COM" }, rules)
    expect(mutations[0]?.envelopeId).toBe("env-streaming")
  })

  it("evaluates eq, starts_with, gte, and lte operators", () => {
    const rules = [
      rule({
        id: "eq",
        type: "skip",
        trigger: "on_import",
        priority: 0,
        conditions: [{ field: "payee", op: "eq", value: "exact match" }],
        actions: [{ type: "exclude", params: {} }],
      }),
      rule({
        id: "starts",
        type: "auto_tag",
        trigger: "on_import",
        priority: 1,
        conditions: [{ field: "payee", op: "starts_with", value: "uber" }],
        actions: [{ type: "add_tag", params: { tag: "rideshare" } }],
      }),
      rule({
        id: "gte",
        type: "irregular_income",
        trigger: "on_import",
        priority: 2,
        conditions: [{ field: "amount", op: "gte", value: 500 }],
        actions: [{ type: "route_as_income", params: {} }],
      }),
      rule({
        id: "lte",
        type: "skip",
        trigger: "on_import",
        priority: 3,
        conditions: [{ field: "amount", op: "lte", value: 1 }],
        actions: [{ type: "exclude", params: {} }],
      }),
    ]

    expect(evaluateRules("on_import", { payee: "Exact Match" }, rules)[0]?.ruleId).toBe("eq")
    expect(evaluateRules("on_import", { payee: "Uber Trip" }, rules)[0]?.addTags).toEqual(["rideshare"])
    expect(evaluateRules("on_import", { payee: "Bonus", amount: 600 }, rules)[0]?.routeAsIncome).toBe(true)
    expect(evaluateRules("on_import", { payee: "Fee", amount: 0.5 }, rules)[0]?.exclude).toBe(true)
  })

  it("treats empty conditions as always matching", () => {
    const rules = [
      rule({
        id: "r1",
        type: "round_up",
        trigger: "on_save",
        conditions: [],
        actions: [{ type: "round_up_savings", params: {} }],
      }),
    ]
    expect(evaluateRules("on_save", { payee: "Coffee", type: "expense" }, rules)).toHaveLength(1)
  })

  it("sorts by priority ascending", () => {
    const rules = [
      rule({
        id: "low-priority",
        type: "auto_tag",
        trigger: "on_import",
        priority: 10,
        conditions: [{ field: "payee", op: "contains", value: "amazon" }],
        actions: [{ type: "add_tag", params: { tag: "second" } }],
      }),
      rule({
        id: "high-priority",
        type: "auto_tag",
        trigger: "on_import",
        priority: 1,
        conditions: [{ field: "payee", op: "contains", value: "amazon" }],
        actions: [{ type: "add_tag", params: { tag: "first" } }],
      }),
    ]
    const mutations = evaluateRules("on_import", { payee: "Amazon" }, rules)
    expect(mutations.map((m) => m.ruleId)).toEqual(["high-priority", "low-priority"])
  })

  it("maps action types to mutation fields", () => {
    const rules = [
      rule({
        id: "all-actions",
        type: "auto_categorize",
        trigger: "on_import",
        conditions: [{ field: "payee", op: "contains", value: "clinic" }],
        actions: [
          { type: "exclude", params: {} },
          { type: "set_envelope", params: { envelopeId: "env-health" } },
          { type: "add_tag", params: { tag: "medical" } },
          { type: "rename_payee", params: { canonicalPayee: "Healthcare" } },
          { type: "route_as_income", params: {} },
          { type: "auto_confirm_recurring", params: {} },
          { type: "redact_payee", params: { alias: "Doctor Visit" } },
        ],
      }),
    ]
    const m = evaluateRules("on_import", { payee: "City Clinic" }, rules)[0]
    expect(m?.exclude).toBe(true)
    expect(m?.envelopeId).toBe("env-health")
    expect(m?.addTags).toEqual(["medical"])
    expect(m?.renamedPayee).toBe("Healthcare")
    expect(m?.routeAsIncome).toBe(true)
    expect(m?.autoConfirm).toBe(true)
    expect(m?.redactAlias).toBe("Doctor Visit")
  })

  it("ignores invalid regex conditions", () => {
    const rules = [
      rule({
        id: "r1",
        type: "skip",
        trigger: "on_import",
        conditions: [{ field: "payee", op: "regex", value: "[invalid" }],
        actions: [{ type: "exclude", params: {} }],
      }),
    ]
    expect(evaluateRules("on_import", { payee: "anything" }, rules)).toEqual([])
  })
})

describe("mergeRuleMutations", () => {
  it("merges envelope, exclude, tags, payee, and flags with last-wins semantics", () => {
    const delta = mergeRuleMutations(
      [
        {
          ruleId: "a",
          ruleType: "auto_categorize",
          envelopeId: "env-a",
          addTags: ["food"],
        },
        {
          ruleId: "b",
          ruleType: "skip",
          exclude: true,
          envelopeId: "env-b",
          addTags: ["groceries"],
          renamedPayee: "Whole Foods",
          routeAsIncome: true,
          autoConfirm: true,
          redactAlias: "Groceries",
        },
      ],
      ["existing"],
    )

    expect(delta.appliedRuleIds).toEqual(["a", "b"])
    expect(delta.envelopeId).toBe("env-b")
    expect(delta.excludeFromMainHistory).toBe(true)
    expect(delta.payee).toBe("Whole Foods")
    expect(delta.routeAsIncome).toBe(true)
    expect(delta.autoConfirm).toBe(true)
    expect(delta.redactAlias).toBe("Groceries")
    expect(delta.tags?.sort()).toEqual(["existing", "food", "groceries"])
  })

  it("returns empty tags when no tags were added", () => {
    const delta = mergeRuleMutations([{ ruleId: "a", ruleType: "skip", exclude: true }])
    expect(delta.tags).toBeUndefined()
  })
})

describe("calculateRoundUpCents", () => {
  it("returns spare change to the next dollar", () => {
    expect(calculateRoundUpCents(437)).toBe(63)
    expect(calculateRoundUpCents(401)).toBe(99)
  })

  it("returns 0 for whole-dollar amounts", () => {
    expect(calculateRoundUpCents(500)).toBe(0)
    expect(calculateRoundUpCents(0)).toBe(0)
  })
})

describe("hasRoundUpRule", () => {
  it("detects enabled round_up rules on on_save or on_income", () => {
    expect(
      hasRoundUpRule([
        rule({ id: "r1", type: "round_up", trigger: "on_save", enabled: true }),
      ]),
    ).toBe(true)
    expect(
      hasRoundUpRule([
        rule({ id: "r1", type: "round_up", trigger: "on_income", enabled: true }),
      ]),
    ).toBe(true)
    expect(
      hasRoundUpRule([
        rule({ id: "r1", type: "round_up", trigger: "on_import", enabled: true }),
      ]),
    ).toBe(false)
    expect(
      hasRoundUpRule([
        rule({ id: "r1", type: "round_up", trigger: "on_save", enabled: false }),
      ]),
    ).toBe(false)
  })
})

describe("getSavingsFloorAmount", () => {
  it("returns floor amount from the first enabled savings_floor rule", () => {
    expect(
      getSavingsFloorAmount([
        rule({
          id: "r1",
          type: "savings_floor",
          trigger: "on_schedule",
          actions: [{ type: "savings_floor", params: { floorAmount: 750 } }],
        }),
      ]),
    ).toBe(750)
  })

  it("returns 0 when no enabled savings floor rule exists", () => {
    expect(getSavingsFloorAmount([])).toBe(0)
    expect(
      getSavingsFloorAmount([
        rule({
          id: "r1",
          type: "savings_floor",
          trigger: "on_schedule",
          enabled: false,
          actions: [{ type: "savings_floor", params: { floorAmount: 500 } }],
        }),
      ]),
    ).toBe(0)
  })
})

describe("getRedactedPayee", () => {
  it("returns alias when a redact rule matches on on_save", () => {
    const rules = [
      rule({
        id: "r1",
        type: "redact",
        trigger: "on_save",
        conditions: [{ field: "payee", op: "contains", value: "clinic" }],
        actions: [{ type: "redact_payee", params: { alias: "Healthcare" } }],
      }),
    ]
    expect(getRedactedPayee("City Clinic Visit", rules)).toBe("Healthcare")
  })

  it("returns original payee when no redact rule matches", () => {
    expect(getRedactedPayee("Starbucks", [])).toBe("Starbucks")
  })
})
