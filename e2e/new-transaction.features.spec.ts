import "./load-env"
import { test, expect, type Locator, type Page } from "@playwright/test"
import { E2E_APP_ENVELOPE_A, E2E_APP_TAG, E2E_APP_USER_EMAIL } from "./fixtures/app-e2e-constants"
import { signInAppUser } from "./helpers/app-session"
import { fetchJsonInPage } from "./helpers/fetch-json"

async function openNewTransaction(page: Page): Promise<void> {
  await page.getByTitle("New Transaction").click()
  await expect(page.getByRole("heading", { name: "New Transaction" })).toBeVisible()
}

async function dismissWalkthroughIfVisible(page: Page): Promise<void> {
  const skipWalkthrough = page.getByRole("button", { name: "Skip walkthrough" })
  if (await skipWalkthrough.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await skipWalkthrough.click()
    await expect(skipWalkthrough).toBeHidden({ timeout: 10_000 })
  }
}

async function completeWalkthroughForSpec(page: Page): Promise<void> {
  const { status } = await fetchJsonInPage(page, "/api/user/settings", {
    method: "PUT",
    body: { walkthroughCompleted: true },
  })
  expect(status).toBe(200)
  await page.reload()
}

async function navigateToTransactions(page: Page): Promise<void> {
  await page.getByRole("button", { name: "TRANSACTIONS" }).click()
  await expect(page.getByRole("heading", { name: "All Transactions" })).toBeVisible({ timeout: 30_000 })
}

async function chooseEnvelope(dialog: Locator): Promise<void> {
  await dialog.getByRole("combobox").click()
  await dialog.page().getByRole("option", { name: E2E_APP_ENVELOPE_A }).click()
}

async function openDialogSection(dialog: Locator, buttonName: RegExp, headingName: string): Promise<void> {
  const heading = dialog.getByRole("heading", { name: headingName })
  await expect(async () => {
    await dialog.getByRole("button", { name: buttonName }).click()
    await expect(heading).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 10_000 })
}

async function finishSuccess(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: "Saved!" })).toBeVisible({ timeout: 30_000 })
  await dialog.getByRole("button", { name: "Done" }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
}

test.describe("New transaction features", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_APP_USER_EMAIL)
    await completeWalkthroughForSpec(page)
    await dismissWalkthroughIfVisible(page)
    await navigateToTransactions(page)
    await expect(page.getByText("E2E Grocery Run").first()).toBeVisible({ timeout: 90_000 })
    await openNewTransaction(page)
  })

  test("add expense with tag", async ({ page }) => {
    const payee = `E2E Manual ${Date.now()}`
    const dialog = page.getByRole("dialog")
    await page.locator("#payee").fill(payee)
    await page.locator("#amount").fill("19.99")
    await chooseEnvelope(dialog)
    await openDialogSection(dialog, /Tags/, "Tags")
    await dialog.locator('[data-slot="badge"]').filter({ hasText: E2E_APP_TAG }).click()
    await dialog.getByRole("button", { name: "Done" }).click()
    await page.getByRole("button", { name: "Add Expense" }).click()
    await finishSuccess(page)
    await expect(page.getByText(payee).first()).toBeVisible({ timeout: 30_000 })
  })

  test("recurring expense appears in upcoming section", async ({ page }) => {
    const payee = `E2E Recurring Rule ${Date.now()}`
    const dialog = page.getByRole("dialog")
    await page.locator("#payee").fill(payee)
    await page.locator("#amount").fill("5")
    await chooseEnvelope(dialog)
    await openDialogSection(dialog, /Recurring/, "Recurring Settings")
    await dialog.getByRole("switch").click()
    await dialog.getByRole("combobox").click()
    await page.getByRole("option", { name: "Weekly", exact: true }).click()
    await dialog.getByRole("button", { name: "Done" }).click()
    await page.getByRole("button", { name: "Add Recurring Expense" }).click()
    await finishSuccess(page)
    await expect(page.getByText("Upcoming Recurring")).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(payee).first()).toBeVisible({ timeout: 30_000 })
  })

  test("save and use shortcut", async ({ page }) => {
    const payee = `E2E Shortcut Payee ${Date.now()}`
    const dialog = page.getByRole("dialog")
    await page.locator("#payee").fill(payee)
    await page.locator("#amount").fill("3.50")
    await chooseEnvelope(dialog)
    await page.getByRole("checkbox", { name: "Save as shortcut" }).click()
    const shortcutCreated = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/shortcuts") &&
        response.request().method() === "POST" &&
        response.ok(),
    )
    await page.getByRole("button", { name: "Add Expense" }).click()
    await shortcutCreated
    await finishSuccess(page)

    await openNewTransaction(page)
    await expect(page.getByRole("button", { name: payee }).first()).toBeVisible({ timeout: 15_000 })
    await page.getByRole("button", { name: payee }).first().click()
    await expect(page.locator("#payee")).toHaveValue(payee)
  })
})
