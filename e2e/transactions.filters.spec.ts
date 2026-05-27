import "./load-env"
import { test, expect, type Page } from "@playwright/test"
import { prisma } from "../lib/db"
import {
  E2E_APP_ENVELOPE_A,
  E2E_APP_TAG,
  E2E_APP_USER_EMAIL,
} from "./fixtures/app-e2e-constants"
import { signInAppUser } from "./helpers/app-session"

function transactionRow(page: Page, payee: string) {
  return page.locator("tbody tr").filter({ hasText: payee })
}

async function seededTransactionDate(payee: string): Promise<string> {
  const txn = await prisma.transaction.findFirst({
    where: { payee, user: { email: E2E_APP_USER_EMAIL } },
    select: { date: true },
  })
  if (!txn) throw new Error(`Missing seeded transaction for ${E2E_APP_USER_EMAIL}: ${payee}`)
  return txn.date.toISOString().slice(0, 10)
}

test.describe("Transactions filters", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInAppUser(page, origin, E2E_APP_USER_EMAIL)
    await page.goto(`${origin}/#/transactions`)
    await expect(transactionRow(page, "E2E Grocery Run")).toBeVisible({ timeout: 90_000 })
  })

  test("search, type, envelope pill, and tag filters", async ({ page }) => {
    await page.getByPlaceholder("Search existing transactions...").fill("Grocery")
    await expect(transactionRow(page, "E2E Grocery Run")).toBeVisible()
    await expect(transactionRow(page, "E2E Bus Fare")).toHaveCount(0)
    await expect(transactionRow(page, "E2E Paycheck")).toHaveCount(0)

    await page.getByPlaceholder("Search existing transactions...").fill("")
    await page.getByRole("combobox").first().click()
    await page.getByRole("option", { name: "Expenses" }).click()
    await expect(transactionRow(page, "E2E Grocery Run")).toBeVisible()
    await expect(transactionRow(page, "E2E Bus Fare")).toBeVisible()
    await expect(transactionRow(page, "E2E Paycheck")).toHaveCount(0)

    await page.getByRole("combobox").first().click()
    await page.getByRole("option", { name: "Credits" }).click()
    await expect(transactionRow(page, "E2E Paycheck")).toBeVisible()
    await expect(transactionRow(page, "E2E Grocery Run")).toHaveCount(0)
    await expect(transactionRow(page, "E2E Bus Fare")).toHaveCount(0)

    await page.getByRole("combobox").first().click()
    await page.getByRole("option", { name: "All Types" }).click()
    await page.getByRole("button", { name: new RegExp(E2E_APP_ENVELOPE_A, "i") }).click()
    await expect(transactionRow(page, "E2E Grocery Run")).toBeVisible()
    await expect(transactionRow(page, "E2E Paycheck")).toBeVisible()
    await expect(transactionRow(page, "E2E Bus Fare")).toHaveCount(0)
    await page.getByRole("button", { name: "Clear" }).first().click()
    await expect(transactionRow(page, "E2E Bus Fare")).toBeVisible()

    await page.getByRole("button", { name: E2E_APP_TAG, exact: true }).click()
    await expect(transactionRow(page, "E2E Grocery Run")).toBeVisible()
    await expect(transactionRow(page, "E2E Bus Fare")).toHaveCount(0)
    await expect(transactionRow(page, "E2E Paycheck")).toHaveCount(0)
  })

  test("date range filter narrows and clears transaction rows", async ({ page }) => {
    const groceryDate = await seededTransactionDate("E2E Grocery Run")

    const dateInputs = page.locator('input[type="date"]')
    await dateInputs.first().fill(groceryDate)
    await dateInputs.nth(1).fill(groceryDate)

    await expect(transactionRow(page, "E2E Grocery Run")).toBeVisible()
    await expect(transactionRow(page, "E2E Paycheck")).toBeVisible()
    await expect(transactionRow(page, "E2E Bus Fare")).toHaveCount(0)

    await dateInputs.first().fill("")
    await dateInputs.nth(1).fill("")

    await expect(transactionRow(page, "E2E Grocery Run")).toBeVisible()
    await expect(transactionRow(page, "E2E Paycheck")).toBeVisible()
    await expect(transactionRow(page, "E2E Bus Fare")).toBeVisible()
  })
})
