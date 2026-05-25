import "./load-env"
import { test, expect } from "@playwright/test"
import { E2E_APP_USER_EMAIL, E2E_PREMIUM_USER_EMAIL } from "./fixtures/app-e2e-constants"
import { signInAppUser } from "./helpers/app-session"

test.describe("Analytics ranges", () => {
  test("vanilla user sees core charts without opportunity cost", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_APP_USER_EMAIL)
    await page.goto(`${origin}/#/analytics`)
    await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible({ timeout: 90_000 })
    await expect(page.getByRole("heading", { name: "Daily Activity" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Cash Flow" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Opportunity Cost" })).toHaveCount(0)
    await page.getByRole("button", { name: "3M", exact: true }).first().click()
    await expect(page.getByRole("button", { name: "3M", exact: true }).first()).toHaveAttribute(
      "aria-pressed",
      "true",
    )
  })

  test("premium OC user sees opportunity cost chart", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_PREMIUM_USER_EMAIL)
    await page.goto(`${origin}/#/analytics`)
    await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible({ timeout: 90_000 })
    await expect(page.getByRole("heading", { name: "Opportunity Cost" })).toBeVisible()
  })
})
