import { expect, type Page } from "@playwright/test"

export async function openBudgetingRulesSettings(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/#/settings/budgeting-rules`)
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("heading", { name: "Recurring rules" })).toBeVisible({
    timeout: 15_000,
  })
}

export async function saveIrregularIncomeSchedule(
  page: Page,
  params: { amount: string; payee: string },
): Promise<void> {
  await page.getByLabel("Amount (USD)").fill(params.amount)
  await page.getByLabel("Who paid you").fill(params.payee)
  await page.getByRole("button", { name: "Next" }).click()
  await page.getByRole("radio", { name: /Fill envelopes now/i }).check()
  await page.getByRole("button", { name: "Schedule this" }).click()
  const savePromise = page.waitForResponse(
    (res) =>
      res.url().includes("/api/recurring-rules") && res.request().method() === "POST",
  )
  await page.getByRole("button", { name: "Save schedule" }).click()
  const saveRes = await savePromise
  expect(saveRes.ok(), await saveRes.text()).toBeTruthy()
}
