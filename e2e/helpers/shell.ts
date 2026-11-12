import { expect, type Page } from "@playwright/test"

/** Sidebar launcher — unique on desktop; avoids strict-mode clash with mobile FAB walkthrough anchor. */
export function sidebarNewTransactionButton(page: Page) {
  return page.getByTitle("New Transaction")
}

export async function expectAppShellReady(page: Page): Promise<void> {
  await expect(sidebarNewTransactionButton(page)).toBeVisible({ timeout: 90_000 })
}

export async function expectTransactionsPageReady(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "All Transactions" })).toBeVisible({
    timeout: 90_000,
  })
}

export async function expectEnvelopesPageReady(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Add Envelope" })).toBeVisible({
    timeout: 90_000,
  })
}

/** Post-save celebration dialog blocks reopening New Transaction until dismissed. */
export async function dismissSavedCelebrationIfPresent(page: Page): Promise<void> {
  const saved = page.getByRole("dialog", { name: "Saved!" })
  if (await saved.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await saved.getByRole("button", { name: "Done" }).click()
    await expect(saved).not.toBeVisible({ timeout: 10_000 })
  }
}

/** Dismiss first-run walkthrough if it appears (forces dashboard navigation while open). */
export async function dismissWalkthroughIfPresent(page: Page): Promise<void> {
  const skip = page.getByRole("button", { name: "Skip walkthrough" })
  if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await skip.click()
    await expect(skip).not.toBeVisible({ timeout: 10_000 })
  }
}

/** Wait for async payee-rules fetch on Transactions so filter rows stop shifting. */
export async function waitForPayeeRulesLoaded(page: Page): Promise<void> {
  await page
    .waitForResponse(
      (resp) => resp.url().includes("/api/payee-rules") && resp.request().method() === "GET",
      { timeout: 30_000 },
    )
    .catch(() => {
      /* banner may have loaded before we subscribed */
    })
}
