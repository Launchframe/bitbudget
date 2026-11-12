import { describe, expect, it } from "vitest"
import {
  QUICK_TEMPLATES,
  rulesForCategory,
  templateIsActive,
  type AccountRule,
} from "@/lib/account-rules"

function accountRule(
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

describe("templateIsActive", () => {
  it("returns true when an enabled rule references the template id", () => {
    const rules = [
      accountRule({
        id: "r1",
        type: "round_up",
        trigger: "on_save",
        templateId: "round_up_savings",
      }),
    ]
    expect(templateIsActive("round_up_savings", rules)).toBe(true)
  })

  it("returns false when the template rule is disabled", () => {
    const rules = [
      accountRule({
        id: "r1",
        type: "round_up",
        trigger: "on_save",
        enabled: false,
        templateId: "round_up_savings",
      }),
    ]
    expect(templateIsActive("round_up_savings", rules)).toBe(false)
  })

  it("returns false when no rule references the template id", () => {
    expect(templateIsActive("skip_transfers", [])).toBe(false)
  })
})

describe("rulesForCategory", () => {
  it("groups rules by category metadata and sorts by priority", () => {
    const rules = [
      accountRule({ id: "a", type: "skip", trigger: "on_import", priority: 5 }),
      accountRule({ id: "b", type: "round_up", trigger: "on_save", priority: 1 }),
      accountRule({ id: "c", type: "redact", trigger: "on_save", priority: 2 }),
    ]

    expect(rulesForCategory(rules, "import_scan").map((r) => r.id)).toEqual(["a"])
    expect(rulesForCategory(rules, "savings_sweep").map((r) => r.id)).toEqual(["b"])
    expect(rulesForCategory(rules, "privacy").map((r) => r.id)).toEqual(["c"])
  })
})

describe("QUICK_TEMPLATES", () => {
  it("defines unique template ids with matching defaultRule.templateId", () => {
    const ids = QUICK_TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const template of QUICK_TEMPLATES) {
      expect(template.defaultRule.templateId).toBe(template.id)
    }
  })
})
