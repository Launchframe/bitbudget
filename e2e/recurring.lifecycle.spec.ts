import "./load-env"
import { test, expect } from "@playwright/test"
import { E2E_RECURRING_USER_EMAIL } from "./fixtures/recurring-e2e-constants"
import { signInWithE2eEmail } from "./helpers/auth-email"

test.describe("Recurring transactions (UI)", () => {
  test("seeded due rule appears in transactions list and upcoming section", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInWithE2eEmail(page, origin, E2E_RECURRING_USER_EMAIL)

    await page.goto(`${origin}/#/transactions`)
    await expect(page.getByText("E2E Recurring Payee").first()).toBeVisible({ timeout: 90_000 })
    await expect(page.getByText("Upcoming Recurring", { exact: false })).toBeVisible({ timeout: 30_000 })
  })
})
