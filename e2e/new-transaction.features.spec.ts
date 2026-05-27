import "./load-env"
import { test, expect } from "@playwright/test"
import { E2E_APP_ENVELOPE_A, E2E_APP_USER_EMAIL } from "./fixtures/app-e2e-constants"
import { signInAppUser } from "./helpers/app-session"

test.describe("New transaction features", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_APP_USER_EMAIL)
    await page.goto(`${origin}/#/transactions`)
    await expect(page.getByText("E2E Grocery Run").first()).toBeVisible({ timeout: 90_000 })
    await page.locator('[data-walkthrough="new-transaction"]').click()
    await expect(page.getByRole("heading", { name: "New Transaction" })).toBeVisible()
  })

  test("add expense with tag", async ({ page }) => {
    const payee = `E2E Manual ${Date.now()}`
    await page.locator("#payee").fill(payee)
    await page.locator("#amount").fill("19.99")
    await page
      .locator("div")
      .filter({ has: page.getByText("Envelope", { exact: true }) })
      .getByRole("combobox")
      .click()
    await page.getByRole("option", { name: E2E_APP_ENVELOPE_A }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("button", { name: "Tags" }).click()
    await dialog.locator('[data-slot="badge"]').filter({ hasText: "e2e-tag" }).click()
    await dialog.getByRole("button", { name: "Done" }).click()
    await page.getByRole("button", { name: "Add Expense" }).click()
    await expect(page.getByRole("heading", { name: "New Transaction" })).toBeHidden({ timeout: 30_000 })
    await expect(page.getByText(payee).first()).toBeVisible({ timeout: 30_000 })
  })

  test("recurring expense appears in upcoming section", async ({ page }) => {
    const payee = `E2E Recurring Rule ${Date.now()}`
    await page.locator("#payee").fill(payee)
    await page.locator("#amount").fill("5")
    await page
      .locator("div")
      .filter({ has: page.getByText("Envelope", { exact: true }) })
      .getByRole("combobox")
      .click()
    await page.getByRole("option", { name: E2E_APP_ENVELOPE_A }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("button", { name: "Recurring" }).click()
    await dialog.getByRole("switch").click()
    await dialog.getByRole("combobox").click()
    await page.getByRole("option", { name: "Weekly", exact: true }).click()
    await dialog.getByRole("button", { name: "Done" }).click()
    await page.getByRole("button", { name: "Add Recurring Expense" }).click()
    await expect(page.getByRole("heading", { name: "New Transaction" })).toBeHidden({ timeout: 30_000 })
    await expect(page.getByText("Upcoming Recurring")).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(payee).first()).toBeVisible({ timeout: 30_000 })
  })

  test("save and use shortcut", async ({ page }) => {
    const payee = `E2E Shortcut Payee ${Date.now()}`
    await page.locator("#payee").fill(payee)
    await page.locator("#amount").fill("3.50")
    await page
      .locator("div")
      .filter({ has: page.getByText("Envelope", { exact: true }) })
      .getByRole("combobox")
      .click()
    await page.getByRole("option", { name: E2E_APP_ENVELOPE_A }).click()
    await page.getByRole("checkbox", { name: "Save as shortcut" }).click()
    await page.getByRole("button", { name: "Add Expense" }).click()
    await expect(page.getByRole("heading", { name: "New Transaction" })).toBeHidden({ timeout: 30_000 })

    await page.locator('[data-walkthrough="new-transaction"]').click()
    await expect(page.getByRole("button", { name: payee }).first()).toBeVisible({ timeout: 15_000 })
    await page.getByRole("button", { name: payee }).first().click()
    await expect(page.locator("#payee")).toHaveValue(payee)
  })
})
