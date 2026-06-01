import "./load-env"
import { test, expect } from "@playwright/test"
import { prisma } from "../lib/db"
import {
  TX_SOURCE_FUNDING_IN,
  TX_SOURCE_FUNDING_OUT,
  TX_SOURCE_INCOME_IMPORT,
  TX_SOURCE_IRREGULAR_INCOME,
  TX_SOURCE_PAYCHECK,
} from "../lib/constants"
import { isBudgetAllocationDay } from "../lib/budget-period"
import { creditPaycheckToSavings, processMonthlyBudgetAllocations } from "../lib/envelope-funding"
import { processFundingCronUser } from "../lib/envelope-funding-cron"
import { ensureSystemSavingsEnvelope } from "../lib/ensure-system-savings-envelope"
import {
  E2E_IMPORT_PAST_YEAR,
  E2E_INCOME_IMPORT_USER_EMAIL,
  INCOME_IMPORTER_DRAFT_KEY,
} from "./fixtures/income-importer-e2e-constants"
import {
  E2E_INCOME_OVERHAUL_EMAIL,
  E2E_INCOME_OVERHAUL_ZERO_ALLOC_EMAIL,
} from "./fixtures/income-overhaul-e2e-constants"
import {
  fillIrregularIncomeDetails,
  openAdjustEnvelopesDialog,
  openEnvelopesPage,
  openIrregularIncomeDialog,
  openMoveFundsFromAdjust,
  signInIncomeOverhaulUser,
} from "./helpers/income-overhaul"
import {
  expectReviewImportEnabled,
  fillPaintBar,
  monthGridLabel,
  openIncomeImporterDialog,
  paintMonthCell,
  setScrollYear,
  signInAndOpenSettings,
} from "./helpers/income-importer"
import {
  getIncomeOverhaulUserId,
  resetIncomeOverhaulUserData,
} from "./seed-income-overhaul-e2e"
import { resetIncomeImporterUserData } from "./seed-income-importer-e2e"

const PAYDAY_UTC = new Date(Date.UTC(2026, 4, 15, 12, 0, 0))
const BUDGET_DAY_UTC = new Date(Date.UTC(2026, 5, 1, 12, 0, 0))

const CRON_USER_FIELDS = {
  payCadence: "bimonthly" as const,
  payDays: [15],
  payDayOfWeek: null as number | null,
  lastPaydayAt: null as Date | null,
}

test.describe("Income overhaul — ledger rhythm", () => {
  test("zero envelope allotments: paycheck credits Savings only (no funding legs)", async () => {
    await resetIncomeOverhaulUserData(E2E_INCOME_OVERHAUL_ZERO_ALLOC_EMAIL)
    const userId = await getIncomeOverhaulUserId(E2E_INCOME_OVERHAUL_ZERO_ALLOC_EMAIL)
    await ensureSystemSavingsEnvelope(userId)

    const created = await creditPaycheckToSavings(userId, PAYDAY_UTC)
    expect(created).toBe(1)

    const fundingLegs = await prisma.transaction.count({
      where: {
        userId,
        source: { in: [TX_SOURCE_FUNDING_IN, TX_SOURCE_FUNDING_OUT] },
      },
    })
    expect(fundingLegs).toBe(0)

    const paycheckCredits = await prisma.transaction.count({
      where: { userId, source: TX_SOURCE_PAYCHECK },
    })
    expect(paycheckCredits).toBe(1)

    const allocLegs = await processMonthlyBudgetAllocations(userId, BUDGET_DAY_UTC)
    expect(allocLegs).toBe(0)
  })

  test("payday on 15th credits Savings; UTC 1st runs gap allocations not paycheck", async () => {
    await resetIncomeOverhaulUserData(E2E_INCOME_OVERHAUL_EMAIL)
    const userId = await getIncomeOverhaulUserId(E2E_INCOME_OVERHAUL_EMAIL)
    await ensureSystemSavingsEnvelope(userId)

    expect(isBudgetAllocationDay(PAYDAY_UTC)).toBe(false)
    expect(isBudgetAllocationDay(BUDGET_DAY_UTC)).toBe(true)

    const paydayResult = await processFundingCronUser(
      { id: userId, ...CRON_USER_FIELDS },
      PAYDAY_UTC,
      false,
    )
    expect(paydayResult.paycheckCreditsCreated).toBeGreaterThan(0)
    expect(paydayResult.allocationLegsCreated).toBe(0)

    const firstResult = await processFundingCronUser(
      { id: userId, ...CRON_USER_FIELDS },
      BUDGET_DAY_UTC,
      true,
    )
    expect(firstResult.paycheckCreditsCreated).toBe(0)
    expect(firstResult.allocationLegsCreated).toBeGreaterThan(0)
  })
})

test.describe("Income overhaul — UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((draftKey) => {
      sessionStorage.removeItem(draftKey)
    }, INCOME_IMPORTER_DRAFT_KEY)
  })

  test("envelopes page shows 1st refill copy and adjust envelopes entry", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await resetIncomeOverhaulUserData(E2E_INCOME_OVERHAUL_EMAIL)
    await signInIncomeOverhaulUser(page, origin, E2E_INCOME_OVERHAUL_EMAIL)
    await openEnvelopesPage(page, origin)

    await expect(
      page.getByText("Spending envelopes refill on the 1st of each month. Paydays add to Savings."),
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "Adjust envelopes" })).toBeVisible()
  })

  test("extra income defaults to Savings", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await resetIncomeOverhaulUserData(E2E_INCOME_OVERHAUL_EMAIL)
    const userId = await getIncomeOverhaulUserId(E2E_INCOME_OVERHAUL_EMAIL)
    await signInIncomeOverhaulUser(page, origin, E2E_INCOME_OVERHAUL_EMAIL)
    await openEnvelopesPage(page, origin)

    await openIrregularIncomeDialog(page)
    await fillIrregularIncomeDetails(page, { amount: "250", payee: "E2E Bonus Client" })
    await page.getByRole("button", { name: "Next" }).click()

    await expect(page.getByRole("dialog", { name: "Where should it go?" })).toBeVisible()
    await expect(page.getByText("Put it in Savings")).toBeVisible()
    await page.getByRole("button", { name: "Review" }).click()
    await expect(page.getByText("All of this will land in Savings.")).toBeVisible()

    const postPromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/transactions/irregular-income") &&
        res.request().method() === "POST",
    )
    await page.getByRole("button", { name: "Confirm" }).click()
    expect((await postPromise).ok()).toBeTruthy()

    await expect(page.getByRole("dialog", { name: "Income recorded" })).toBeVisible()
    await expect(page.getByText(/\$250.*to Savings/i)).toBeVisible()

    await expect
      .poll(async () =>
        prisma.transaction.count({
          where: { userId, source: TX_SOURCE_IRREGULAR_INCOME },
        }),
      )
      .toBeGreaterThan(0)

    const fundingLegs = await prisma.transaction.count({
      where: {
        userId,
        source: { in: [TX_SOURCE_FUNDING_IN, TX_SOURCE_FUNDING_OUT] },
      },
    })
    expect(fundingLegs).toBe(0)
  })

  test("extra income distribution fills envelopes from income pool", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await resetIncomeOverhaulUserData(E2E_INCOME_OVERHAUL_EMAIL)
    const userId = await getIncomeOverhaulUserId(E2E_INCOME_OVERHAUL_EMAIL)
    await signInIncomeOverhaulUser(page, origin, E2E_INCOME_OVERHAUL_EMAIL)
    await openEnvelopesPage(page, origin)

    await openIrregularIncomeDialog(page)
    await fillIrregularIncomeDetails(page, { amount: "500", payee: "E2E Side Gig" })
    await page.getByRole("button", { name: "Next" }).click()

    await page.getByRole("radio", { name: /Fill envelopes now/i }).check()
    await page.getByRole("button", { name: "Add full budget amount" }).click()
    await expect(page.getByText(/affected envelope/i)).toBeVisible({ timeout: 15_000 })

    await page.getByRole("button", { name: "Review" }).click()
    await expect(page.getByText(/across \d+ envelope/i)).toBeVisible()

    const postPromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/transactions/irregular-income") &&
        res.request().method() === "POST",
    )
    await page.getByRole("button", { name: "Confirm" }).click()
    expect((await postPromise).ok()).toBeTruthy()
    await expect(page.getByRole("dialog", { name: "Income recorded" })).toBeVisible()

    await expect
      .poll(async () =>
        prisma.transaction.count({
          where: { userId, source: TX_SOURCE_IRREGULAR_INCOME },
        }),
      )
      .toBeGreaterThan(0)
  })

  test("move funds: sliders update After bar and POST succeeds", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await resetIncomeOverhaulUserData(E2E_INCOME_OVERHAUL_EMAIL)
    const userId = await getIncomeOverhaulUserId(E2E_INCOME_OVERHAUL_EMAIL)
    const savings = await ensureSystemSavingsEnvelope(userId)

    await prisma.transaction.create({
      data: {
        userId,
        envelopeId: savings.id,
        payee: "E2E Seed Savings",
        amount: 1000,
        type: "credit",
        date: PAYDAY_UTC,
        tags: "[]",
        source: TX_SOURCE_IRREGULAR_INCOME,
      },
    })

    await signInIncomeOverhaulUser(page, origin, E2E_INCOME_OVERHAUL_EMAIL)
    await openEnvelopesPage(page, origin)
    await openMoveFundsFromAdjust(page)

    await expect(page.getByText("Before")).toBeVisible()
    await expect(page.getByText("After")).toBeVisible()
    await page.getByRole("button", { name: "Choose each" }).click()

    const dialog = page.getByRole("dialog", { name: "Move funds" })
    const slider = dialog.locator(`input[type="range"]`).first()
    await expect(slider).toBeVisible()

    await slider.evaluate((el) => {
      const input = el as HTMLInputElement
      input.value = String(Math.min(Number(input.max), 50))
      input.dispatchEvent(new Event("input", { bubbles: true }))
      input.dispatchEvent(new Event("change", { bubbles: true }))
    })

    await expect(slider).not.toHaveValue("0")
    await expect(dialog.getByText(/\$50/)).toBeVisible()

    const movePromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/transactions/move-funds") &&
        res.request().method() === "POST",
    )
    await dialog.getByRole("button", { name: "Move funds" }).click()
    const moveRes = await movePromise
    expect(moveRes.ok(), await moveRes.text()).toBeTruthy()

    await expect(page.getByText("Funds moved successfully.")).toBeVisible({ timeout: 15_000 })
  })

  test("fund from Savings opens move funds in independent mode", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await resetIncomeOverhaulUserData(E2E_INCOME_OVERHAUL_EMAIL)
    const userId = await getIncomeOverhaulUserId(E2E_INCOME_OVERHAUL_EMAIL)
    await ensureSystemSavingsEnvelope(userId)

    await signInIncomeOverhaulUser(page, origin, E2E_INCOME_OVERHAUL_EMAIL)
    await openEnvelopesPage(page, origin)

    await openAdjustEnvelopesDialog(page)
    await page.getByRole("button", { name: "Fund envelopes from Savings" }).click()
    const fundDialog = page.getByRole("dialog", { name: "Fund from Savings" })
    await expect(fundDialog).toBeVisible()
    await expect(fundDialog.getByRole("button", { name: "Choose each" })).toBeVisible()
    await expect(fundDialog.getByText("Before")).toBeVisible()
    await expect(fundDialog.getByText("After")).toBeVisible()
  })

  test("settings budgeting rules tab loads recurring rules section", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInIncomeOverhaulUser(page, origin, E2E_INCOME_OVERHAUL_EMAIL)
    await page.goto(`${origin}/#/settings/payee-mappings`)
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText("Budgeting rules")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Recurring rules" })).toBeVisible({
      timeout: 15_000,
    })
  })

  test("schedule this shows coming-soon state for automatic runs", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await signInIncomeOverhaulUser(page, origin, E2E_INCOME_OVERHAUL_EMAIL)
    await openEnvelopesPage(page, origin)
    await openIrregularIncomeDialog(page)
    await fillIrregularIncomeDetails(page, { amount: "100", payee: "E2E Schedule Test" })
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByRole("radio", { name: /Fill envelopes now/i }).check()
    await page.getByRole("button", { name: "Schedule this" }).click()
    await expect(
      page.getByText(/Automatic runs on that schedule are not available yet/i),
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "Save schedule (coming soon)" })).toBeDisabled()
  })

  test("income importer creates Savings credits only (no funding legs)", async ({
    page,
    baseURL,
  }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await resetIncomeImporterUserData(E2E_INCOME_IMPORT_USER_EMAIL)
    const user = await prisma.user.findUnique({
      where: { email: E2E_INCOME_IMPORT_USER_EMAIL },
      select: { id: true },
    })
    expect(user?.id).toBeTruthy()

    await signInAndOpenSettings(page, origin, E2E_INCOME_IMPORT_USER_EMAIL)
    await openIncomeImporterDialog(page)
    await setScrollYear(page, E2E_IMPORT_PAST_YEAR)
    await fillPaintBar(page, 2800, "E2E No Legs Co")
    await paintMonthCell(page, monthGridLabel(E2E_IMPORT_PAST_YEAR, 3))
    await expectReviewImportEnabled(page)
    await page.getByRole("button", { name: "Review" }).click()

    const importPromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/transactions/income-import") &&
        res.request().method() === "POST",
    )
    await page.getByRole("button", { name: "Save past income" }).click()
    expect((await importPromise).ok()).toBeTruthy()

    await expect
      .poll(async () =>
        prisma.transaction.count({
          where: { userId: user!.id, source: TX_SOURCE_INCOME_IMPORT },
        }),
      )
      .toBeGreaterThan(0)

    const fundingLegs = await prisma.transaction.count({
      where: {
        userId: user!.id,
        source: { in: [TX_SOURCE_FUNDING_IN, TX_SOURCE_FUNDING_OUT] },
      },
    })
    expect(fundingLegs).toBe(0)
  })
})
