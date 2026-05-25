import "./load-env"
import { test, expect } from "@playwright/test"
import {
  E2E_APP_ENVELOPE_A,
  E2E_APP_TAG,
  E2E_APP_USER_EMAIL,
} from "./fixtures/app-e2e-constants"
import { signInAppUser } from "./helpers/app-session"

test.describe("Transactions filters", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_APP_USER_EMAIL)
    await page.goto(`${origin}/#/transactions`)
    await expect(page.getByText("E2E Grocery Run").first()).toBeVisible({ timeout: 90_000 })
  })

  test("search, type, envelope pill, and tag filters", async ({ page }) => {
    await page.getByPlaceholder("Search existing transactions...").fill("Grocery")
    await expect(page.getByText("E2E Grocery Run").first()).toBeVisible()
    await expect(page.getByText("E2E Bus Fare")).toHaveCount(0)

    await page.getByPlaceholder("Search existing transactions...").fill("")
    await page.getByRole("combobox").first().click()
    await page.getByRole("option", { name: "Expenses" }).click()
    await expect(page.getByText("E2E Grocery Run").first()).toBeVisible()
    await expect(page.getByText("E2E Paycheck")).toHaveCount(0)

    await page.getByRole("combobox").first().click()
    await page.getByRole("option", { name: "Credits" }).click()
    await expect(page.getByText("E2E Paycheck").first()).toBeVisible()
    await expect(page.getByText("E2E Grocery Run")).toHaveCount(0)

    await page.getByRole("combobox").first().click()
    await page.getByRole("option", { name: "All Types" }).click()
    await page.getByRole("button", { name: new RegExp(E2E_APP_ENVELOPE_A, "i") }).click()
    await expect(page.getByText("E2E Grocery Run").first()).toBeVisible()
    await expect(page.getByText("E2E Bus Fare")).toHaveCount(0)
    await page.getByRole("button", { name: "Clear" }).first().click()

    await page.getByRole("button", { name: E2E_APP_TAG, exact: true }).click()
    await expect(page.getByText("E2E Grocery Run").first()).toBeVisible()
    await expect(page.getByText("E2E Bus Fare")).toHaveCount(0)
  })
})
