import "./load-env"
import { test, expect } from "@playwright/test"
import { deleteE2eUserByEmail } from "./helpers/e2e-user"
import { fetchJsonInPage } from "./helpers/fetch-json"
import { onboardingTestEmail } from "./fixtures/onboarding-e2e-constants"
import {
  startOnboardingUser,
  skipReferralStep,
  completeSecurityPassphrase,
  configureIncomeStep,
  continueEnvelopesStep,
  continueBudgetAllocations,
  skipSavingsGoalStep,
  skipImportStep,
  finishOnboardingToDashboard,
} from "./helpers/onboarding"

test.describe("Onboarding income modes", () => {
  test.beforeEach(async ({ request, baseURL }, testInfo) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    const email = onboardingTestEmail(testInfo.testId.replace(/[^a-z0-9-]/gi, "-").slice(0, 40))
    await deleteE2eUserByEmail(request, origin, email)
    testInfo.annotations.push({ type: "email", description: email })
  })

  async function emailFromAnnotations(testInfo: import("@playwright/test").TestInfo): Promise<string> {
    const a = testInfo.annotations.find(x => x.type === "email")
    if (!a?.description) throw new Error("missing email annotation")
    return a.description
  }

  test("regular paycheck saves monthly cadence and bounded budget UI", async ({ page, baseURL }, testInfo) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    const email = await emailFromAnnotations(testInfo)
    await startOnboardingUser(page, origin, email)
    await skipReferralStep(page)
    await completeSecurityPassphrase(page)
    await configureIncomeStep(page, { mode: "regular", paycheck: "2500" })
    await continueEnvelopesStep(page)
    await expect(page.getByText(/\$[\d,]+ monthly budget/)).toBeVisible()
    await continueBudgetAllocations(page)
    await skipSavingsGoalStep(page)
    await skipImportStep(page)
    await finishOnboardingToDashboard(page, origin)

    const { status, json } = await fetchJsonInPage(page, "/api/user/settings")
    expect(status).toBe(200)
    expect(json?.payCadence).toBe("monthly")
    expect(json?.monthlyIncome).toBe(2500)
    expect(json?.onboardingComplete).toBe(true)
  })

  test("irregular without annual estimate uses unbounded allocation copy", async ({
    page,
    baseURL,
  }, testInfo) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    const email = await emailFromAnnotations(testInfo)
    await startOnboardingUser(page, origin, email)
    await skipReferralStep(page)
    await completeSecurityPassphrase(page)
    await configureIncomeStep(page, { mode: "irregular" })
    await continueEnvelopesStep(page)
    await expect(page.getByText(/monthly budget/i)).not.toBeVisible()
    await page.getByRole("textbox", { name: "0" }).first().fill("200")
    await expect(page.getByText(/\$200 estimated monthly spend/i)).toBeVisible({ timeout: 10_000 })
    await continueBudgetAllocations(page)
    await skipSavingsGoalStep(page)
    await skipImportStep(page)
    await finishOnboardingToDashboard(page, origin)

    const { json } = await fetchJsonInPage(page, "/api/user/settings")
    expect(json?.payCadence).toBe("irregular")
    expect(json?.monthlyIncome).toBe(0)
    expect(json?.estimatedAnnualIncome).toBeNull()
  })

  test("irregular with annual estimate bounds budget to annual/12", async ({ page, baseURL }, testInfo) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    const email = await emailFromAnnotations(testInfo)
    await startOnboardingUser(page, origin, email)
    await skipReferralStep(page)
    await completeSecurityPassphrase(page)
    await configureIncomeStep(page, { mode: "irregular", annualEstimate: "60000" })
    await continueEnvelopesStep(page)
    await expect(page.getByText(/\$5,000 monthly budget/)).toBeVisible()
    await continueBudgetAllocations(page)
    await skipSavingsGoalStep(page)
    await skipImportStep(page)
    await finishOnboardingToDashboard(page, origin)

    const { json } = await fetchJsonInPage(page, "/api/user/settings")
    expect(json?.payCadence).toBe("irregular")
    expect(json?.monthlyIncome).toBe(5000)
    expect(json?.estimatedAnnualIncome).toBe(60000)
  })

  test("mixed timing saves mixed cadence and combines incomes", async ({ page, baseURL }, testInfo) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    const email = await emailFromAnnotations(testInfo)
    await startOnboardingUser(page, origin, email)
    await skipReferralStep(page)
    await completeSecurityPassphrase(page)
    await configureIncomeStep(page, { mode: "mix", paycheck: "2000", annualEstimate: "12000" })
    await continueEnvelopesStep(page)
    await continueBudgetAllocations(page)
    await skipSavingsGoalStep(page)
    await skipImportStep(page)
    await finishOnboardingToDashboard(page, origin)

    const { json } = await fetchJsonInPage(page, "/api/user/settings")
    expect(json?.payCadence).toBe("mixed")
    expect(json?.monthlyIncome).toBe(3000)
    expect(json?.estimatedAnnualIncome).toBe(12000)
  })
})
