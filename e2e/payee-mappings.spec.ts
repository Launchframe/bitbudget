import "./load-env"
import { test, expect } from "@playwright/test"
import { E2E_APP_USER_EMAIL } from "./fixtures/app-e2e-constants"
import { signInAppUser } from "./helpers/app-session"

test.describe("Payee rules", () => {
  let createdRuleId: string | null = null

  test.beforeEach(async ({ page, baseURL }) => {
    createdRuleId = null
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_APP_USER_EMAIL)
  })

  test.afterEach(async ({ page }) => {
    if (!createdRuleId) return

    await page.evaluate(async (ruleId) => {
      await fetch(`/api/payee-rules?id=${encodeURIComponent(ruleId)}`, {
        method: "DELETE",
        credentials: "include",
      })
    }, createdRuleId)
  })

  test("manual rule in settings", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await page.goto(`${origin}/#/settings/payee-rules`)
    await expect(page.getByRole("heading", { name: "Payee name rules" })).toBeVisible({
      timeout: 30_000,
    })

    // normalizePayeeKey lowercases the source before persisting it; displaySource renders
    // a.sourceNormalized when the source has no matching transaction payee (always true for a
    // brand-new timestamp string). Use lowercase so the assertion matches the rendered text.
    const ts = Date.now()
    const source = `e2e rule src ${ts}`
    const canonical = `E2E Canonical ${ts}`
    await page.locator("#payee-map-source").fill(source)
    await page.locator("#payee-map-canonical").fill(canonical)
    const ruleResponsePromise = page.waitForResponse((res) => {
      return res.url().includes("/api/payee-rules") && res.request().method() === "POST"
    })
    await page.getByRole("button", { name: "Save rule" }).click()
    const ruleResponse = await ruleResponsePromise
    const ruleRow: unknown = await ruleResponse.json()
    createdRuleId =
      ruleRow && typeof ruleRow === "object" && "id" in ruleRow && typeof ruleRow.id === "string"
        ? ruleRow.id
        : null
    expect(createdRuleId).toBeTruthy()

    // UI renders source and destination in separate nodes (no "From" prefix); see Saved rules list.
    const savedRow = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: "Remove rule" }) })
      .filter({ hasText: source })
    await expect(savedRow).toBeVisible()
    await expect(savedRow).toContainText(canonical)
  })
})
