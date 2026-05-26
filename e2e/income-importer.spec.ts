import "./load-env"
import { test, expect } from "@playwright/test"
import { prisma } from "../lib/db"
import { TX_SOURCE_INCOME_IMPORT } from "../lib/constants"
import {
  E2E_IMPORT_PAST_YEAR,
  E2E_INCOME_IMPORT_USER_EMAIL,
  E2E_INCOME_IMPORT_ZERO_MI_EMAIL,
  INCOME_IMPORTER_DRAFT_KEY,
} from "./fixtures/income-importer-e2e-constants"
import {
  cellEditDialog,
  closeIncomeImporterDialog,
  currentMonthGridLabel,
  fillPaintBar,
  monthGridLabel,
  openCellEdit,
  openIncomeImporterDialog,
  paintDefaultPastRange,
  paintMonthCell,
  expectReviewImportEnabled,
  setScrollYear,
  signInAndOpenSettings,
  waitForImporterDraftEntries,
} from "./helpers/income-importer"
import { resetIncomeImporterUserData } from "./seed-income-importer-e2e"

test.describe("Income importer (UI)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((draftKey) => {
      sessionStorage.removeItem(draftKey)
    }, INCOME_IMPORTER_DRAFT_KEY)
  })

  test("paint monthly range, edit a cell, review and confirm import", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await resetIncomeImporterUserData(E2E_INCOME_IMPORT_USER_EMAIL)
    await signInAndOpenSettings(page, origin, E2E_INCOME_IMPORT_USER_EMAIL)
    await openIncomeImporterDialog(page)

    await paintDefaultPastRange(page)
    await expectReviewImportEnabled(page)

    const febLabel = monthGridLabel(E2E_IMPORT_PAST_YEAR, 2)
    await openCellEdit(page, febLabel)
    await page.getByLabel("Total income (USD)").fill("5500")
    await cellEditDialog(page).getByRole("button", { name: "Save" }).click()
    await expect(cellEditDialog(page)).not.toBeVisible()

    await page.getByRole("button", { name: "Review import" }).click()
    await expect(page.getByText("Review staged income before importing.")).toBeVisible()
    await expect(page.getByRole("columnheader", { name: "Was" })).toBeVisible()
    await expect(page.getByRole("row", { name: new RegExp(`Edit ${febLabel}`, "i") })).toBeVisible()

    const user = await prisma.user.findUnique({
      where: { email: E2E_INCOME_IMPORT_USER_EMAIL },
      select: { id: true },
    })
    expect(user?.id).toBeTruthy()

    const importPromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/transactions/income-import") &&
        res.request().method() === "POST",
      { timeout: 30_000 },
    )
    await page.getByRole("button", { name: "Confirm import" }).click()
    const importRes = await importPromise
    expect(importRes.ok(), await importRes.text()).toBeTruthy()

    await expect(page.getByRole("button", { name: "Go to Dashboard" })).toBeVisible({
      timeout: 15_000,
    })

    await expect
      .poll(async () =>
        prisma.transaction.count({
          where: { userId: user!.id, source: TX_SOURCE_INCOME_IMPORT },
        }),
      )
      .toBeGreaterThan(0)
  })

  test("close mid-edit restores draft; Clear All resets; nested Cancel keeps parent open", async ({
    page,
    baseURL,
  }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await resetIncomeImporterUserData(E2E_INCOME_IMPORT_USER_EMAIL)
    await signInAndOpenSettings(page, origin, E2E_INCOME_IMPORT_USER_EMAIL)
    await openIncomeImporterDialog(page)

    await setScrollYear(page, E2E_IMPORT_PAST_YEAR)
    await fillPaintBar(page, 4200, "Draft Employer")
    await paintMonthCell(page, monthGridLabel(E2E_IMPORT_PAST_YEAR, 6))
    await expectReviewImportEnabled(page)

    const junLabel = monthGridLabel(E2E_IMPORT_PAST_YEAR, 6)
    await openCellEdit(page, junLabel)
    await cellEditDialog(page).getByRole("button", { name: "Cancel" }).click()
    await expect(page.getByRole("dialog", { name: "Import income" })).toBeVisible()
    await expect(cellEditDialog(page)).not.toBeVisible()

    await waitForImporterDraftEntries(page, 1)
    await closeIncomeImporterDialog(page)

    await openIncomeImporterDialog(page)
    await expect(page.locator("#paint-source")).toHaveValue("Draft Employer")
    await expect(page.locator("#paint-amount")).toHaveValue("4200")

    await page.getByRole("button", { name: "Clear All" }).click()
    await expect(page.getByRole("alertdialog", { name: "Reset everything?" })).toBeVisible()
    await page.getByRole("button", { name: "Reset" }).click()
    await expect(page.locator("#paint-source")).toHaveValue("")
    await expect(page.getByRole("button", { name: "Review import" })).toBeDisabled()
  })

  test("past-only import succeeds when Monthly Income is unset", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await resetIncomeImporterUserData(E2E_INCOME_IMPORT_ZERO_MI_EMAIL)
    await signInAndOpenSettings(page, origin, E2E_INCOME_IMPORT_ZERO_MI_EMAIL)
    await openIncomeImporterDialog(page)

    await setScrollYear(page, E2E_IMPORT_PAST_YEAR)
    await fillPaintBar(page, 3000, "Past Only Co")
    await paintMonthCell(page, monthGridLabel(E2E_IMPORT_PAST_YEAR, 4))
    await expectReviewImportEnabled(page)

    await page.getByRole("button", { name: "Review import" }).click()
    const importPromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/transactions/income-import") &&
        res.request().method() === "POST",
    )
    await page.getByRole("button", { name: "Confirm import" }).click()
    expect((await importPromise).ok()).toBeTruthy()
    await expect(page.getByRole("button", { name: "Go to Dashboard" })).toBeVisible()
  })

  test("import including current month without Monthly Income shows clear error", async ({
    page,
    baseURL,
  }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await resetIncomeImporterUserData(E2E_INCOME_IMPORT_ZERO_MI_EMAIL)
    await signInAndOpenSettings(page, origin, E2E_INCOME_IMPORT_ZERO_MI_EMAIL)
    await openIncomeImporterDialog(page)

    const currentLabel = currentMonthGridLabel()
    const currentYear = new Date().getUTCFullYear()
    await setScrollYear(page, currentYear)
    await fillPaintBar(page, 4000, "Current Month Co")
    await paintMonthCell(page, currentLabel)
    await expectReviewImportEnabled(page)

    await page.getByRole("button", { name: "Review import" }).click()
    await page.getByRole("button", { name: "Confirm import" }).click()
    await expect(
      page.getByRole("alert").filter({
        hasText: "Set a positive Monthly Income in Settings before importing the current month or year.",
      }),
    ).toBeVisible()
  })

  test("success step Go to Dashboard lands on Cash Flow chart with All range", async ({
    page,
    baseURL,
  }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await resetIncomeImporterUserData(E2E_INCOME_IMPORT_USER_EMAIL)
    await signInAndOpenSettings(page, origin, E2E_INCOME_IMPORT_USER_EMAIL)
    await openIncomeImporterDialog(page)

    await setScrollYear(page, E2E_IMPORT_PAST_YEAR)
    await fillPaintBar(page, 2500, "Dashboard Handoff Co")
    await paintMonthCell(page, monthGridLabel(E2E_IMPORT_PAST_YEAR, 5))
    await expectReviewImportEnabled(page)

    await page.getByRole("button", { name: "Review import" }).click()
    const importPromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/transactions/income-import") &&
        res.request().method() === "POST",
    )
    await page.getByRole("button", { name: "Confirm import" }).click()
    expect((await importPromise).ok()).toBeTruthy()

    await page.getByRole("button", { name: "Go to Dashboard" }).click()
    await expect(page.getByRole("heading", { name: "Your cash flow" })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("button", { name: "Cash Flow", pressed: true })).toBeVisible()

    const allRange = page.getByRole("button", { name: "All", exact: true })
    await expect(allRange).toBeVisible()
    await expect(allRange).toHaveClass(/bg-\[#F7931A\]/)
  })
})
