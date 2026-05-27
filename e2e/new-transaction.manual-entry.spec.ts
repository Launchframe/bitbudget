import "./load-env"
import { test, expect } from "@playwright/test"
import { E2E_RECURRING_USER_EMAIL } from "./fixtures/recurring-e2e-constants"
import { signInWithE2eEmail } from "./helpers/auth-email"

/**
 * Regression: payee `useEffect` cleared the field on every keystroke when
 * `openNewTransaction()` had no prefill payee (c214122 / recurring work).
 */
test.describe("New Transaction manual entry", () => {
  test("payee field accepts typing without clearing (no prefill)", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInWithE2eEmail(page, origin, E2E_RECURRING_USER_EMAIL)

    await page.goto(`${origin}/#/transactions`)
    await expect(page.getByText("E2E Recurring Payee").first()).toBeVisible({ timeout: 90_000 })

    await page.getByTitle("New Transaction").click()
    await expect(page.getByRole("heading", { name: "New Transaction" })).toBeVisible({ timeout: 15_000 })

    const payee = page.locator("#payee")
    await expect(payee).toBeVisible()
    await payee.click()
    await payee.fill("")
    const phrase = "Manual payee E2E"
    await payee.pressSequentially(phrase, { delay: 15 })
    await expect(payee).toHaveValue(phrase)
  })
})
