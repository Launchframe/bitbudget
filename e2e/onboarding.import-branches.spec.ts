import "./load-env"
import path from "path"
import { test, expect } from "@playwright/test"
import { deleteE2eUserByEmail } from "./helpers/e2e-user"
import { onboardingTestEmail } from "./fixtures/onboarding-e2e-constants"
import {
  startOnboardingUser,
  runOnboardingThroughSavingsGamePlan,
  attachCsvOnImportStep,
  submitImportAndContinue,
  confirmCsvImportInDialog,
  finishImportDialogToComplete,
  skipImportStep,
  finishOnboardingToDashboard,
} from "./helpers/onboarding"

test.describe("Onboarding CSV import branches", () => {
  test.beforeEach(async ({ request, baseURL }, testInfo) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    const email = onboardingTestEmail(`import-${testInfo.testId.replace(/[^a-z0-9-]/gi, "-").slice(0, 32)}`)
    await deleteE2eUserByEmail(request, origin, email)
    testInfo.annotations.push({ type: "email", description: email })
  })

  function emailFromAnnotations(testInfo: import("@playwright/test").TestInfo): string {
    const a = testInfo.annotations.find(x => x.type === "email")
    if (!a?.description) throw new Error("missing email annotation")
    return a.description
  }

  test("skip import reaches dashboard", async ({ page, baseURL }, testInfo) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    const email = emailFromAnnotations(testInfo)
    await startOnboardingUser(page, origin, email)
    await runOnboardingThroughSavingsGamePlan(page, { mode: "regular", paycheck: "3000" })
    await skipImportStep(page)
    await finishOnboardingToDashboard(page, origin)
  })

  test("CSV import with existing envelopes completes to dashboard", async ({ page, baseURL }, testInfo) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    const email = emailFromAnnotations(testInfo)
    await startOnboardingUser(page, origin, email)
    await runOnboardingThroughSavingsGamePlan(page, { mode: "regular", paycheck: "3000" })
    await attachCsvOnImportStep(page, "onboarding-import.csv")
    await submitImportAndContinue(page)
    await confirmCsvImportInDialog(page)
    await finishImportDialogToComplete(page, false)
    await finishOnboardingToDashboard(page, origin)
    await page.goto(`${origin}/#/transactions`)
    await expect(page.getByText("Grocery Store").first()).toBeVisible({ timeout: 90_000 })
  })

  test("re-importing the same CSV creates no duplicate rows", async ({ page, baseURL }, testInfo) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    const email = emailFromAnnotations(testInfo)
    await startOnboardingUser(page, origin, email)
    await runOnboardingThroughSavingsGamePlan(page, { mode: "regular", paycheck: "3000" })
    await attachCsvOnImportStep(page, "onboarding-import.csv")
    await submitImportAndContinue(page)
    await confirmCsvImportInDialog(page)
    await finishImportDialogToComplete(page, false)
    await finishOnboardingToDashboard(page, origin)

    await page.goto(`${origin}/#/transactions`)
    const groceryRows = page.locator("main tbody tr").filter({ hasText: "Grocery Store" })
    await expect(groceryRows.first()).toBeVisible({ timeout: 90_000 })
    await expect(groceryRows).toHaveCount(1)

    // Re-import the exact same file from the app shell. Client dedup runs during preview
    // load and skips straight to the allDupes step — no preview Import button.
    const fixturePath = path.join(__dirname, "fixtures", "onboarding-import.csv")
    await page.locator("#csv-import-input").setInputFiles(fixturePath)

    const dialog = page.getByRole("dialog")
    await expect(dialog.getByRole("heading", { name: "Already imported" })).toBeVisible({
      timeout: 30_000,
    })
    await expect(
      dialog.getByText("It looks like you've already imported all these transactions."),
    ).toBeVisible({ timeout: 30_000 })

    // Close and confirm the count is still exactly one.
    await dialog.getByRole("button", { name: "OK" }).click()
    await page.goto(`${origin}/#/transactions`)
    await expect(groceryRows.first()).toBeVisible({ timeout: 90_000 })
    await expect(groceryRows).toHaveCount(1)
  })

  test("CSV with new envelope offers Back to envelopes → budget step", async ({ page, baseURL }, testInfo) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    const email = emailFromAnnotations(testInfo)
    await startOnboardingUser(page, origin, email)
    await runOnboardingThroughSavingsGamePlan(page, { mode: "regular", paycheck: "3000" })
    await attachCsvOnImportStep(page, "onboarding-import-new-envelope.csv")
    await submitImportAndContinue(page)
    await confirmCsvImportInDialog(page)
    await finishImportDialogToComplete(page, true)
    await expect(page.getByRole("heading", { name: "Your budget" })).toBeVisible()
  })
})
