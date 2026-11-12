import "./load-env"
import { test, expect } from "@playwright/test"
import { E2E_APP_ENVELOPE_A, E2E_APP_USER_EMAIL } from "./fixtures/app-e2e-constants"
import { signInAppUser } from "./helpers/app-session"
import { dismissWalkthroughIfPresent } from "./helpers/shell"

const PRECISE_ALLOTMENT = 1813.13

test.describe("Envelope allocations", () => {
  test("persists penny-precise allotment from text entry", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_APP_USER_EMAIL)
    await page.goto(`${origin}/#/envelopes/allocations`)
    await dismissWalkthroughIfPresent(page)
    await expect(page.getByText("Monthly Income").first()).toBeVisible({ timeout: 90_000 })

    const amountInput = page.getByLabel(`${E2E_APP_ENVELOPE_A} monthly allotment amount`)
    await expect(amountInput).toBeVisible({ timeout: 30_000 })

    await amountInput.click()
    await amountInput.fill("")
    await amountInput.pressSequentially("1813.13", { delay: 30 })
    await expect(amountInput).toHaveValue("1813.13")

    const saveResponse = page.waitForResponse(
      resp =>
        resp.url().includes("/api/envelopes") &&
        resp.request().method() === "PUT" &&
        resp.ok(),
    )
    await page.getByRole("button", { name: "Save Allocations" }).click()
    await saveResponse
    await expect(page.getByRole("button", { name: "Add Envelope" })).toBeVisible({
      timeout: 30_000,
    })

    const listRes = await page.request.get(`${origin}/api/envelopes`)
    expect(listRes.ok()).toBe(true)
    const envelopes = (await listRes.json()) as Array<{
      name: string
      monthlyAllotment: number
    }>
    const groceries = envelopes.find(e => e.name === E2E_APP_ENVELOPE_A)
    expect(groceries?.monthlyAllotment).toBe(PRECISE_ALLOTMENT)

    await page.goto(`${origin}/#/envelopes/allocations`)
    await expect(amountInput).toBeVisible({ timeout: 30_000 })
    await expect(amountInput).toHaveValue("1813.13")
  })
})
