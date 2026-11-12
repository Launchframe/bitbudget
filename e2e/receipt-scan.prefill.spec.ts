import "./load-env"
import path from "node:path"
import { test, expect } from "@playwright/test"
import { E2E_TRIAL_USER_EMAIL } from "./fixtures/app-e2e-constants"
import { signInAppUser } from "./helpers/app-session"

/**
 * Full client path: choose file → POST /api/receipts/scan → openNewTransaction prefill.
 * With E2E_TEST=true the scan route returns deterministic mock extraction (no OpenAI).
 */
test.describe("Receipt scan → New Transaction prefill", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
  })

  test("PNG upload prefills dialog and receipt image preview", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_TRIAL_USER_EMAIL)

    await page.goto(`${origin}/#/transactions`)
    await expect(page.getByRole("heading", { name: /transactions/i }).first()).toBeVisible({ timeout: 90_000 })

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

    await expect(page.getByRole("button", { name: "Show scan details" })).toBeVisible()
    await page.getByRole("button", { name: "Show scan details" }).click()
    await expect(page.getByText("Reading quality")).toBeVisible()
    await expect(page.getByText("GPT-4o mini")).toBeVisible()
  })

  test("PDF upload prefills transaction fields", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_TRIAL_USER_EMAIL)

    await page.goto(`${origin}/#/transactions`)
    await expect(page.getByRole("heading", { name: /transactions/i }).first()).toBeVisible({ timeout: 90_000 })

    await page.getByTitle("Scan Receipt").click()
    await expect(page.getByRole("heading", { name: "Scan Receipt" })).toBeVisible()

    const fileChooserPromise = page.waitForEvent("filechooser")
    await page.getByRole("button", { name: "Upload File" }).click()
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(path.join(__dirname, "fixtures/minimal-receipt.pdf"))

    await expect(page.getByRole("heading", { name: "New Transaction" })).toBeVisible({ timeout: 30_000 })

    await expect(page.locator("#payee")).toHaveValue("Receipt Scan Café ZZ99")
    await expect(page.locator("#amount")).toHaveValue("42.50")
    await expect(page.locator("#date")).toHaveValue("2026-04-01")

    await expect(page.getByRole("button", { name: "Show scan details" })).toBeVisible()
    await page.getByRole("button", { name: "Show scan details" }).click()
    await expect(page.getByText("Reading quality")).toBeVisible()
    await expect(page.getByText("PDF document")).toBeVisible()
    await expect(page.getByText("GPT-4o mini")).toBeVisible()
  })
})
