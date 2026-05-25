import "./load-env"
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
