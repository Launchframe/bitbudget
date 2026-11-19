import { describe, expect, it } from "vitest"
import { assertShoppingQaSeedEmail, SHOPPING_QA_SEED_EMAILS } from "@/lib/shopping-qa-seed"

describe("assertShoppingQaSeedEmail", () => {
  it("allows the owner and member QA accounts", () => {
    expect(() => assertShoppingQaSeedEmail(SHOPPING_QA_SEED_EMAILS.owner)).not.toThrow()
    expect(() => assertShoppingQaSeedEmail(SHOPPING_QA_SEED_EMAILS.member)).not.toThrow()
  })

  it("refuses other test-domain users and lookalikes", () => {
    const rejected = [
      "e2e-recurring@bitbudget.test",
      "not-shopping-owner@bitbudget.test",
      "Shopping-Owner@bitbudget.test",
      "shopping-owner@bitbudget.test.evil.example",
      "user@example.com",
      "",
    ]
    for (const email of rejected) {
      expect(() => assertShoppingQaSeedEmail(email)).toThrow(/allowlisted shopping QA account/)
    }
  })
})
