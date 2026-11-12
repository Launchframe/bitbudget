import "./load-env"
import { test, expect } from "@playwright/test"
import { E2E_APP_USER_EMAIL } from "./fixtures/app-e2e-constants"
import type { Page } from "@playwright/test"
import { signInAppUser } from "./helpers/app-session"
import { dismissWalkthroughIfPresent, expectEnvelopesPageReady } from "./helpers/shell"

async function expandArchivedSection(page: Page, envelopeName: string): Promise<void> {
  const toggle = page.getByRole("button", { name: /Archived \(\d+\)/ })
  const restore = page.getByRole("button", { name: `Restore ${envelopeName}` })
  await toggle.click()
  if (!(await restore.isVisible({ timeout: 2_000 }).catch(() => false))) {
    await toggle.click()
  }
  await expect(restore).toBeVisible({ timeout: 15_000 })
}

test.describe("Envelope archive and delete", () => {
  test("archive, undo, restore, and permanent delete", async ({ page, baseURL }) => {
    const origin = baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
    const victim = `E2E Archive ${Date.now()}`
    await signInAppUser(page, origin, E2E_APP_USER_EMAIL)
    await page.goto(`${origin}/#/envelopes`)
    await dismissWalkthroughIfPresent(page)
    await expectEnvelopesPageReady(page)
    await expect(page.getByText("E2E Groceries").first()).toBeVisible({ timeout: 90_000 })

    await page.getByText("Add Envelope").click()
    await page.getByPlaceholder("e.g. Groceries").fill(victim)
    await page.locator('input[type="number"]').first().fill("25")
    await page.getByRole("button", { name: "Create Envelope" }).click()
    await expect(page.getByText(victim).first()).toBeVisible({ timeout: 30_000 })

    const archiveVictim = page.getByRole("button", { name: `Archive ${victim}` })
    await expect(archiveVictim).toBeVisible()
    await archiveVictim.click()
    await expect(page.getByText(`${victim} archived`)).toBeVisible()
    await page.getByTestId("archive-undo").click()
    await expect(page.getByText(victim).first()).toBeVisible()

    await expect(archiveVictim).toBeVisible()
    await archiveVictim.click()
    await expandArchivedSection(page, victim)
    await page.getByRole("button", { name: `Restore ${victim}` }).click()
    await expect(page.getByText(victim).first()).toBeVisible()

    await expect(archiveVictim).toBeVisible()
    await archiveVictim.click()
    await expandArchivedSection(page, victim)
    await page.getByRole("button", { name: `Permanently delete ${victim}` }).click()
    await page.getByRole("button", { name: "Delete envelope" }).click()
    await expect(page.getByText(`${victim} deleted`)).toBeVisible()
    await page.getByTestId("delete-undo").click()
    await expandArchivedSection(page, victim)
    await expect(page.getByRole("button", { name: `Restore ${victim}` })).toBeVisible()

    await page.getByRole("button", { name: `Permanently delete ${victim}` }).click()
    await page.getByRole("button", { name: "Delete envelope" }).click()
    await expect(page.getByRole("button", { name: `Permanently delete ${victim}` })).toHaveCount(0)
    await page.getByRole("button", { name: /Recently deleted \(\d+\)/ }).click()
    await expect(page.getByRole("button", { name: `Restore deleted ${victim}` })).toBeVisible()
  })
})
