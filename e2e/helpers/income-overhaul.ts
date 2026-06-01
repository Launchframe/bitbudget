import { expect, type Page } from "@playwright/test"
import { signInAppUser } from "./app-session"
import { expectEnvelopesPageReady } from "./shell"

export async function signInIncomeOverhaulUser(
  page: Page,
  origin: string,
  email: string,
): Promise<string> {
  return signInAppUser(page, origin, email)
}

export async function openEnvelopesPage(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/#/envelopes`)
  await expectEnvelopesPageReady(page)
}

export async function openAdjustEnvelopesDialog(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Adjust envelopes" }).click()
  await expect(page.getByRole("dialog", { name: "Adjust envelopes" })).toBeVisible()
}

export async function openMoveFundsFromAdjust(page: Page): Promise<void> {
  await openAdjustEnvelopesDialog(page)
  await page.getByRole("button", { name: "Move funds" }).click()
  await expect(page.getByRole("dialog", { name: "Move funds" })).toBeVisible()
}

export async function openIrregularIncomeDialog(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Add extra income" }).click()
  await expect(page.getByRole("dialog", { name: "Add extra income" })).toBeVisible()
}

export async function fillIrregularIncomeDetails(
  page: Page,
  params: { amount: string; payee: string },
): Promise<void> {
  await page.getByLabel("Amount (USD)").fill(params.amount)
  await page.getByLabel("Who paid you").fill(params.payee)
}
