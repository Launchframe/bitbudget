import "./load-env"
import { test, expect } from "@playwright/test"
import { E2E_APP_USER_EMAIL } from "./fixtures/app-e2e-constants"
import { signInAppUser } from "./helpers/app-session"

test.describe("Envelope lifecycle", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_APP_USER_EMAIL)
    await page.goto(`${origin}/#/envelopes`)
    await expect(page.getByText("E2E Groceries").first()).toBeVisible({ timeout: 90_000 })
  })

  test("create, edit, and merge", async ({ page }) => {
    const stamp = Date.now()
    const name = `E2E Hobby ${stamp}`
    const edited = `${name} Edited`

    await page.getByText("Add Envelope").click()
    await page.getByPlaceholder("e.g. Groceries").fill(name)
    await page.locator('input[type="number"]').first().fill("75")
    await page.getByRole("button", { name: "Create Envelope" }).click()
    await expect(page.getByRole("heading", { name: "New Envelope" })).toBeHidden({ timeout: 30_000 })
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 })

    await page.getByRole("button", { name: `Edit ${name}` }).click()
    await page.getByPlaceholder("e.g. Groceries").fill(edited)
    await page.getByRole("button", { name: "Save Changes" }).click()
    await expect(page.getByText(edited).first()).toBeVisible()

    await page.getByRole("button", { name: `Merge ${edited}` }).click()
    await page.getByRole("dialog").getByRole("button", { name: "E2E Groceries" }).click()
    await expect(page.getByText(edited)).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "Merge Envelope" })).toBeHidden({ timeout: 15_000 })
  })
})
