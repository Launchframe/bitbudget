import "./load-env"
import { test, expect } from "@playwright/test"
import { E2E_APP_USER_EMAIL } from "./fixtures/app-e2e-constants"
import { signInAppUser } from "./helpers/app-session"

test.describe("Rules settings", () => {
  const createdAccountRuleIds: string[] = []

  test.beforeEach(async ({ page, baseURL }) => {
    createdAccountRuleIds.length = 0
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_APP_USER_EMAIL)
  })

  test.afterEach(async ({ page }) => {
    for (const ruleId of createdAccountRuleIds) {
      await page.evaluate(async (id) => {
        await fetch(`/api/account-rules?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
          credentials: "include",
        })
      }, ruleId)
    }
  })

  async function waitForAccountRulesLoaded(page: import("@playwright/test").Page) {
    await page
      .waitForResponse(
        (resp) => resp.url().includes("/api/account-rules") && resp.request().method() === "GET",
        { timeout: 30_000 },
      )
      .catch(() => {
        /* may have loaded before subscription */
      })
  }

  test("creates, toggles, and deletes a skip rule", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await page.goto(`${origin}/#/settings/payee-rules`)
    await expect(page.getByRole("heading", { name: "Payee name rules" })).toBeVisible({
      timeout: 30_000,
    })
    await waitForAccountRulesLoaded(page)

    const importSection = page.getByRole("button", { name: /On-import & scan rules/i })
    await expect(importSection).toBeVisible()
    if ((await importSection.getAttribute("aria-expanded")) !== "true") {
      await importSection.click()
    }
    await expect(importSection).toHaveAttribute("aria-expanded", "true")

    const addRuleButton = page
      .locator("section")
      .filter({ has: page.getByRole("button", { name: /On-import & scan rules/i }) })
      .getByRole("button", { name: "Add rule" })
    await addRuleButton.click()

    await expect(page.getByRole("dialog")).toBeVisible()
    await expect(page.getByRole("heading", { name: /Add On-import/i })).toBeVisible()

    const pattern = `e2e-skip-${Date.now()}`
    await page.getByPlaceholder(/TRANSFER|Netflix/i).fill(pattern)

    const createResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/account-rules") && res.request().method() === "POST",
    )
    await page.getByRole("button", { name: "Save rule" }).click()
    const createResponse = await createResponsePromise
    const created: unknown = await createResponse.json()
    const ruleId =
      created && typeof created === "object" && "id" in created && typeof created.id === "string"
        ? created.id
        : null
    expect(ruleId).toBeTruthy()
    if (ruleId) createdAccountRuleIds.push(ruleId)

    const ruleRow = page.getByRole("listitem").filter({ hasText: "Skip / ignore" }).filter({
      hasText: pattern,
    })
    await expect(ruleRow).toBeVisible()

    await ruleRow.getByRole("switch", { name: "Disable rule" }).click()
    await expect(ruleRow.getByRole("switch", { name: "Enable rule" })).toBeVisible()

    await ruleRow.getByRole("button", { name: "Delete rule" }).click()
    await expect(page.getByRole("heading", { name: "Delete this rule?" })).toBeVisible()
    const deleteResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/account-rules") && res.request().method() === "DELETE",
    )
    await page.getByRole("button", { name: "Delete" }).click()
    await deleteResponsePromise

    if (ruleId) {
      const idx = createdAccountRuleIds.indexOf(ruleId)
      if (idx >= 0) createdAccountRuleIds.splice(idx, 1)
    }
    await expect(ruleRow).toHaveCount(0)
  })

  test("activates a quick template", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await page.goto(`${origin}/#/settings/payee-rules`)
    await expect(page.getByRole("heading", { name: "Payee name rules" })).toBeVisible({
      timeout: 30_000,
    })
    await waitForAccountRulesLoaded(page)

    const redactCard = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: "Redact doctor visits" }) })
    const hasTemplate = await redactCard.isVisible().catch(() => false)
    test.skip(!hasTemplate, "Redact quick template already active or hidden for this user")

    const activateResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/account-rules") && res.request().method() === "POST",
    )
    await redactCard.getByRole("button", { name: "Activate" }).click()
    const activateResponse = await activateResponsePromise
    const created: unknown = await activateResponse.json()
    const ruleId =
      created && typeof created === "object" && "id" in created && typeof created.id === "string"
        ? created.id
        : null
    expect(ruleId).toBeTruthy()
    if (ruleId) createdAccountRuleIds.push(ruleId)

    const privacySection = page.getByRole("button", { name: /Privacy rules/i })
    await expect(privacySection).toBeVisible()
    if ((await privacySection.getAttribute("aria-expanded")) !== "true") {
      await privacySection.click()
    }

    const privacyRule = page
      .getByRole("listitem")
      .filter({ hasText: "Redact payee" })
      .first()
    await expect(privacyRule).toBeVisible()
  })
})
