import "./load-env"
import { test, expect } from "@playwright/test"
import { E2E_APP_USER_EMAIL, E2E_PREMIUM_USER_EMAIL } from "./fixtures/app-e2e-constants"
import { signInAppUser } from "./helpers/app-session"

test.describe("Settings tabs", () => {
  test("tags CRUD and export on data security tab", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_APP_USER_EMAIL)

    await page.goto(`${origin}/#/settings/tags`)
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 30_000 })
    const tagName = `e2e-settings-${Date.now()}`
    await page.getByPlaceholder("New tag").fill(tagName)
    await page.getByRole("button", { name: "Add Tag" }).click()
    await expect(page.getByText(tagName)).toBeVisible()
    await page.getByLabel(`Delete tag ${tagName}`).click()
    await expect(page.getByText(tagName)).toHaveCount(0)

    await page.goto(`${origin}/#/settings/data-security`)
    const downloadPromise = page.waitForEvent("download")
    await page.getByRole("button", { name: "Download" }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.csv$/i)
  })

  test("premium user toggles opportunity cost and BTC display", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_PREMIUM_USER_EMAIL)
    await page.goto(`${origin}/#/settings/general`)
    await expect(page.getByText("Premium").first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("heading", { name: "Opportunity Cost" })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByRole("heading", { name: "BTC Display" })).toBeVisible({ timeout: 15_000 })
    // Scope to the nearest card so the collapsed sidebar's "BTC" icon button is excluded.
    const btcDisplayCard = page
      .getByRole("heading", { name: "BTC Display" })
      .locator("xpath=ancestor::div[contains(@class, 'rounded-2xl')][1]")
    await btcDisplayCard.getByRole("button", { name: "BTC", exact: true }).click()
    await expect(page.getByText(/decimal BTC/i)).toBeVisible()
  })

  test("savings tracking dismiss confirm", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_APP_USER_EMAIL)
    await page.goto(`${origin}/#/settings/savings-tracking`)
    await page.getByRole("switch", { name: "Enable Savings tracking" }).click()
    await expect(page.getByRole("heading", { name: "Turn off Savings tracking?" })).toBeVisible()
    await page.getByRole("button", { name: "Turn off tracking" }).click()
    await expect(page.getByRole("button", { name: "Turn on Savings tracking" })).toBeVisible()
    // Re-enable so later tests in this session see the default engaged state.
    await page.getByRole("button", { name: "Turn on Savings tracking" }).click()
    await expect(page.getByRole("switch", { name: "Enable Savings tracking" })).toBeChecked()
  })

  test("import transactions dialog opens from integrations", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_APP_USER_EMAIL)
    await page.goto(`${origin}/#/settings/integrations`)
    await expect(page.getByRole("heading", { name: "Import Transactions" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Choose CSV File" })).toBeVisible()
  })
})

test.describe("Settings mobile layout @mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("settings tabs scroll without page overflow", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_APP_USER_EMAIL)
    await page.goto(`${origin}/#/settings/general`)
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 30_000 })
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2)
  })
})
