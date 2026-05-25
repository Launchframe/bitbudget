import "./load-env"
import { test, expect } from "@playwright/test"
import { E2E_APP_USER_EMAIL } from "./fixtures/app-e2e-constants"
import { signInAppUser } from "./helpers/app-session"

test.describe("Payee mappings", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_APP_USER_EMAIL)
  })

  test("manual mapping in settings", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await page.goto(`${origin}/#/settings/payee-mappings`)
    await expect(page.getByRole("heading", { name: "Payee name mappings" })).toBeVisible({
      timeout: 30_000,
    })

    const source = `E2E Alias Src ${Date.now()}`
    const canonical = `E2E Canonical ${Date.now()}`
    await page.locator("#payee-map-source").fill(source)
    await page.locator("#payee-map-canonical").fill(canonical)
    await page.getByRole("button", { name: "Save mapping" }).click()
    await expect(page.getByText(`From ${source} → ${canonical}`)).toBeVisible()
  })
})
