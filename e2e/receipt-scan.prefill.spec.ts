import "./load-env"
import path from "node:path"
import { test, expect } from "@playwright/test"
import { E2E_RECURRING_USER_EMAIL } from "./fixtures/recurring-e2e-constants"
import { signInWithE2eEmail } from "./helpers/auth-email"

/**
 * Full client path: choose file → POST /api/receipts/scan → openNewTransaction prefill.
 * The scan route is intercepted so CI does not need OpenAI or premium entitlements.
 */
test.describe("Receipt scan → New Transaction prefill", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.route("**/api/receipts/scan", async route => {
      if (route.request().method() !== "POST") {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          payee: "Receipt Scan Café ZZ99",
          amount: "42.50",
          date: "2026-04-01",
        }),
      })
    })
  })

  test("PNG upload prefills dialog and receipt image preview", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInWithE2eEmail(page, origin, E2E_RECURRING_USER_EMAIL)

    await page.goto(`${origin}/#/transactions`)
    await expect(page.getByText("E2E Recurring Payee").first()).toBeVisible({ timeout: 90_000 })

    await page.getByTitle("Scan Receipt").click()
    await expect(page.getByRole("heading", { name: "Scan Receipt" })).toBeVisible()

    const fileChooserPromise = page.waitForEvent("filechooser")
    await page.getByRole("button", { name: "Upload File" }).click()
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(path.join(__dirname, "fixtures/minimal-receipt.png"))

    await expect(page.getByRole("heading", { name: "New Transaction" })).toBeVisible({ timeout: 30_000 })

    await expect(page.locator("#payee")).toHaveValue("Receipt Scan Café ZZ99")
    await expect(page.locator("#amount")).toHaveValue("42.50")
    await expect(page.locator("#date")).toHaveValue("2026-04-01")

    await expect(page.getByRole("img", { name: "Scanned receipt" })).toBeVisible()
  })

  test("PDF upload prefills transaction fields", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInWithE2eEmail(page, origin, E2E_RECURRING_USER_EMAIL)

    await page.goto(`${origin}/#/transactions`)
    await expect(page.getByText("E2E Recurring Payee").first()).toBeVisible({ timeout: 90_000 })

    await page.getByTitle("Scan Receipt").click()

    const fileChooserPromise = page.waitForEvent("filechooser")
    await page.getByRole("button", { name: "Upload File" }).click()
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(path.join(__dirname, "fixtures/minimal-receipt.pdf"))

    await expect(page.getByRole("heading", { name: "New Transaction" })).toBeVisible({ timeout: 30_000 })

    await expect(page.locator("#payee")).toHaveValue("Receipt Scan Café ZZ99")
    await expect(page.locator("#amount")).toHaveValue("42.50")
    await expect(page.locator("#date")).toHaveValue("2026-04-01")
  })
})
