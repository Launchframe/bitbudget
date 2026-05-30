import "./load-env"
import { test, expect } from "@playwright/test"
import { E2E_APP_USER_EMAIL } from "./fixtures/app-e2e-constants"
import { signInAppUser } from "./helpers/app-session"

test.describe("Payee mappings", () => {
  let createdAliasId: string | null = null

  test.beforeEach(async ({ page, baseURL }) => {
    createdAliasId = null
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_APP_USER_EMAIL)
  })

  test.afterEach(async ({ page }) => {
    if (!createdAliasId) return

    await page.evaluate(async (aliasId) => {
      await fetch(`/api/payee-aliases?id=${encodeURIComponent(aliasId)}`, {
        method: "DELETE",
        credentials: "include",
      })
    }, createdAliasId)
  })

  test("manual mapping in settings", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await page.goto(`${origin}/#/settings/payee-mappings`)
    await expect(page.getByRole("heading", { name: "Payee name mappings" })).toBeVisible({
      timeout: 30_000,
    })

    // normalizePayeeKey lowercases the source before persisting it; displaySource renders
    // a.sourceNormalized when the source has no matching transaction payee (always true for a
    // brand-new timestamp string). Use lowercase so the assertion matches the rendered text.
    const ts = Date.now()
    const source = `e2e alias src ${ts}`
    const canonical = `E2E Canonical ${ts}`
    await page.locator("#payee-map-source").fill(source)
    await page.locator("#payee-map-canonical").fill(canonical)
    const aliasResponsePromise = page.waitForResponse((res) => {
      return res.url().includes("/api/payee-aliases") && res.request().method() === "POST"
    })
    await page.getByRole("button", { name: "Save mapping" }).click()
    const aliasResponse = await aliasResponsePromise
    const aliasRow: unknown = await aliasResponse.json()
    createdAliasId =
      aliasRow && typeof aliasRow === "object" && "id" in aliasRow && typeof aliasRow.id === "string"
        ? aliasRow.id
        : null
    expect(createdAliasId).toBeTruthy()

    // UI renders source and destination in separate nodes (no "From" prefix); see Saved mappings list.
    const savedRow = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: "Remove mapping" }) })
      .filter({ hasText: source })
    await expect(savedRow).toBeVisible()
    await expect(savedRow).toContainText(canonical)
  })
})
