import path from "node:path"
import type { Page } from "@playwright/test"
import { expect } from "@playwright/test"
import { E2E_ONBOARDING_PASSPHRASE } from "../fixtures/onboarding-e2e-constants"
import { signInWithE2eEmail } from "./auth-email"

export type IncomeMode = "regular" | "irregular" | "mix"

export interface OnboardingIncomeOptions {
  mode: IncomeMode
  paycheck?: string
  annualEstimate?: string
}

export async function startOnboardingUser(
  page: Page,
  origin: string,
  email: string,
  onboardingSource: "vanilla" | "btc" = "vanilla",
): Promise<void> {
  await page.addInitScript(source => {
    sessionStorage.setItem("onboardingSource", source)
  }, onboardingSource)
  await signInWithE2eEmail(page, origin, email)
  await page.goto(`${origin}/onboarding`)
  await expect(page.getByRole("heading", { name: "Have a referral code?" })).toBeVisible({
    timeout: 30_000,
  })
}

export async function skipReferralStep(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Skip" }).first().click()
  await expect(page.getByRole("heading", { name: "Secure Your Data" })).toBeVisible({
    timeout: 30_000,
  })
}

export async function completeSecurityPassphrase(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Secure Your Data" })).toBeVisible({
    timeout: 30_000,
  })
  const passphraseInputs = page.locator('input[type="password"]')
  await passphraseInputs.nth(0).fill(E2E_ONBOARDING_PASSPHRASE)
  await passphraseInputs.nth(1).fill(E2E_ONBOARDING_PASSPHRASE)
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(page.getByRole("heading", { name: "Your income" })).toBeVisible({ timeout: 30_000 })
}

export async function configureIncomeStep(page: Page, opts: OnboardingIncomeOptions): Promise<void> {
  const modeLabel =
    opts.mode === "regular"
      ? "Regular paycheck"
      : opts.mode === "irregular"
        ? "No regular income"
        : "Mixed timing"
  await page.getByRole("button", { name: modeLabel }).click()

  if (opts.mode === "regular" || opts.mode === "mix") {
    const paycheck = opts.paycheck ?? "2500"
    await page.getByRole("button", { name: "Monthly", exact: true }).click()
    const incomeInput = page.locator('input[placeholder="2,500"]')
    await incomeInput.fill(paycheck)
  }

  if (opts.mode === "irregular" || opts.mode === "mix") {
    if (opts.annualEstimate) {
      const annualInput = page.locator('input[placeholder="60,000"]')
      await annualInput.fill(opts.annualEstimate)
    }
  }

  await page.locator('form').filter({ has: page.getByRole("heading", { name: "Your income" }) }).getByRole("button", { name: "Continue" }).click()
  await expect(page.getByRole("heading", { name: "Your envelopes" })).toBeVisible({ timeout: 30_000 })
}

export async function continueEnvelopesStep(page: Page): Promise<void> {
  await page.locator('form').filter({ has: page.getByRole("heading", { name: "Your envelopes" }) }).getByRole("button", { name: "Continue" }).click()
  await expect(page.getByRole("heading", { name: "Your budget" })).toBeVisible({ timeout: 30_000 })
}

export async function continueBudgetAllocations(page: Page): Promise<void> {
  await page.locator('form').filter({ has: page.getByRole("heading", { name: "Your budget" }) }).getByRole("button", { name: "Continue" }).click()
  await expect(page.getByRole("heading", { name: "Your savings goal" })).toBeVisible({ timeout: 30_000 })
}

export async function skipSavingsGoalStep(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Not for me — I'll stick to my budget" }).click()
  await expect(page.getByRole("heading", { name: "Import Transactions" })).toBeVisible({
    timeout: 30_000,
  })
}

export async function continueSavingsGoalStep(page: Page): Promise<void> {
  await page.locator('form').filter({ has: page.getByRole("heading", { name: "Your savings goal" }) }).getByRole("button", { name: "Continue" }).click()
  await expect(page.getByRole("heading", { name: "Your Savings game plan" })).toBeVisible({
    timeout: 30_000,
  })
}

export async function continueSavingsGamePlan(page: Page): Promise<void> {
  await page
    .locator("div")
    .filter({ has: page.getByRole("heading", { name: "Your Savings game plan" }) })
    .getByRole("button", { name: "Continue" })
    .click()
  await expect(page.getByRole("heading", { name: "Import Transactions" })).toBeVisible({
    timeout: 30_000,
  })
}

export async function skipImportStep(page: Page): Promise<void> {
  await page.locator('form').filter({ has: page.getByRole("heading", { name: "Import Transactions" }) }).getByRole("button", { name: "Skip" }).click()
  await expect(page.getByRole("heading", { name: "You're All Set!" })).toBeVisible({ timeout: 30_000 })
}

export async function attachCsvOnImportStep(page: Page, fixtureName: string): Promise<void> {
  const filePath = path.join(__dirname, "..", "fixtures", fixtureName)
  await page.locator('input[type="file"][accept=".csv"]').setInputFiles(filePath)
}

export async function submitImportAndContinue(page: Page): Promise<void> {
  await page.locator('form').filter({ has: page.getByRole("heading", { name: "Import Transactions" }) }).getByRole("button", { name: "Import & Continue" }).click()
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Import Transactions" })).toBeVisible({
    timeout: 30_000,
  })
}

export async function confirmCsvImportInDialog(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: "Import Transactions" })).toBeVisible()
  const importBtn = dialog.getByRole("button", { name: /Import \d+ Transaction/ })
  await expect(importBtn).toBeVisible({ timeout: 30_000 })
  await importBtn.click()
  await expect(dialog.getByRole("heading", { name: "Import Complete" })).toBeVisible({ timeout: 60_000 })
}

export async function finishImportDialogToComplete(page: Page, useBackToEnvelopes: boolean): Promise<void> {
  const dialog = page.getByRole("dialog")
  if (useBackToEnvelopes) {
    await dialog.getByRole("button", { name: "Back to envelopes" }).click()
    await expect(page.getByRole("heading", { name: "Your budget" })).toBeVisible({ timeout: 30_000 })
    return
  }
  await dialog.getByRole("button", { name: "Done" }).click()
  await expect(page.getByRole("heading", { name: "You're All Set!" })).toBeVisible({ timeout: 30_000 })
}

export async function finishOnboardingToDashboard(page: Page, origin: string): Promise<void> {
  await page.getByRole("button", { name: "Go to Dashboard" }).click()
  await page.waitForURL(url => url.pathname === "/", { timeout: 30_000 })
  await page.goto(`${origin}/#/dashboard`)
  await expect(page.locator('[data-walkthrough="new-transaction"]')).toBeVisible({ timeout: 90_000 })
}

export async function runOnboardingThroughSavingsGamePlan(
  page: Page,
  income: OnboardingIncomeOptions,
): Promise<void> {
  await skipReferralStep(page)
  await completeSecurityPassphrase(page)
  await configureIncomeStep(page, income)
  await continueEnvelopesStep(page)
  await continueBudgetAllocations(page)
  await skipSavingsGoalStep(page)
}
