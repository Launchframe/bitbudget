import "./load-env"
import { test, expect } from "@playwright/test"
import { prisma } from "../lib/db"
import { TX_SOURCE_ENVELOPE_TRANSFER_IN, TX_SOURCE_ENVELOPE_TRANSFER_OUT } from "../lib/constants"
import { creditPaycheckToSavings } from "../lib/envelope-funding"
import { processRecurringFundingRules } from "../lib/recurring-funding-processor"
import { E2E_INCOME_OVERHAUL_EMAIL } from "./fixtures/income-overhaul-e2e-constants"
import {
  openEnvelopesPage,
  openIrregularIncomeDialog,
  signInIncomeOverhaulUser,
} from "./helpers/income-overhaul"
import {
  openBudgetingRulesSettings,
  saveIrregularIncomeSchedule,
} from "./helpers/recurring-funding-rules"
import {
  getIncomeOverhaulUserId,
  resetIncomeOverhaulUserData,
} from "./seed-income-overhaul-e2e"

const RUN_UTC = new Date(Date.UTC(2026, 5, 10, 12, 0, 0))

test.describe("Recurring funding rules", () => {
  test("save schedule from extra income and list in settings", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await resetIncomeOverhaulUserData(E2E_INCOME_OVERHAUL_EMAIL)
    await signInIncomeOverhaulUser(page, origin, E2E_INCOME_OVERHAUL_EMAIL)
    await openEnvelopesPage(page, origin)
    await openIrregularIncomeDialog(page)
    await saveIrregularIncomeSchedule(page, {
      amount: "600",
      payee: "E2E Recurring Schedule",
    })
    await expect(page.getByText(/Saved\. Next automatic run:/i)).toBeVisible({ timeout: 15_000 })

    await openBudgetingRulesSettings(page, origin)
    await expect(page.getByText(/income distribution · monthly/i)).toBeVisible()
  })

  test("delete recurring rule from settings", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    await resetIncomeOverhaulUserData(E2E_INCOME_OVERHAUL_EMAIL)
    const userId = await getIncomeOverhaulUserId(E2E_INCOME_OVERHAUL_EMAIL)
    await prisma.recurringFundingRule.create({
      data: {
        userId,
        kind: "income_distribution",
        frequency: "monthly",
        enabled: true,
        nextRunAt: new Date(Date.UTC(2026, 6, 1, 12, 0, 0)),
        distributionConfig: {
          distributionBehavior: "set_to_budget",
          fundOverageFromSavings: false,
          grossUsd: 100,
        },
      },
    })

    await signInIncomeOverhaulUser(page, origin, E2E_INCOME_OVERHAUL_EMAIL)
    await openBudgetingRulesSettings(page, origin)
    await expect(page.getByText(/income distribution · monthly/i)).toBeVisible()
    const deletePromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/recurring-rules") && res.request().method() === "DELETE",
    )
    await page.getByRole("button", { name: "Delete" }).click()
    const deleteRes = await deletePromise
    expect(deleteRes.ok()).toBeTruthy()
    await expect(page.getByText(/No recurring rules yet/i)).toBeVisible({ timeout: 15_000 })
  })

  test("due income_distribution rule creates transfer legs via processor", async () => {
    await resetIncomeOverhaulUserData(E2E_INCOME_OVERHAUL_EMAIL)
    const userId = await getIncomeOverhaulUserId(E2E_INCOME_OVERHAUL_EMAIL)
    await creditPaycheckToSavings(userId, RUN_UTC)

    await prisma.recurringFundingRule.deleteMany({ where: { userId } })
    await prisma.recurringFundingRule.create({
      data: {
        userId,
        kind: "income_distribution",
        frequency: "monthly",
        enabled: true,
        nextRunAt: new Date(Date.UTC(2020, 0, 1, 12, 0, 0)),
        distributionConfig: {
          distributionBehavior: "set_to_budget",
          fundOverageFromSavings: false,
          grossUsd: 500,
        },
      },
    })

    const legs = await processRecurringFundingRules(userId, RUN_UTC)
    expect(legs).toBeGreaterThan(0)

    const transfers = await prisma.transaction.findMany({
      where: {
        userId,
        source: { in: [TX_SOURCE_ENVELOPE_TRANSFER_IN, TX_SOURCE_ENVELOPE_TRANSFER_OUT] },
      },
    })
    expect(transfers.length).toBeGreaterThan(0)

    const rule = await prisma.recurringFundingRule.findFirst({ where: { userId } })
    expect(rule?.lastRunAt).toBeTruthy()
    expect(rule!.nextRunAt.getTime()).toBeGreaterThan(new Date(Date.UTC(2020, 0, 2)).getTime())
  })

  test("disabled due rule is skipped by processor", async () => {
    await resetIncomeOverhaulUserData(E2E_INCOME_OVERHAUL_EMAIL)
    const userId = await getIncomeOverhaulUserId(E2E_INCOME_OVERHAUL_EMAIL)
    await creditPaycheckToSavings(userId, RUN_UTC)

    await prisma.recurringFundingRule.deleteMany({ where: { userId } })
    await prisma.recurringFundingRule.create({
      data: {
        userId,
        kind: "income_distribution",
        frequency: "monthly",
        enabled: false,
        nextRunAt: new Date(Date.UTC(2020, 0, 1, 12, 0, 0)),
        distributionConfig: {
          distributionBehavior: "set_to_budget",
          fundOverageFromSavings: false,
          grossUsd: 500,
        },
      },
    })

    const legs = await processRecurringFundingRules(userId, RUN_UTC)
    expect(legs).toBe(0)
    const transfers = await prisma.transaction.count({
      where: {
        userId,
        source: { in: [TX_SOURCE_ENVELOPE_TRANSFER_IN, TX_SOURCE_ENVELOPE_TRANSFER_OUT] },
      },
    })
    expect(transfers).toBe(0)
  })
})
