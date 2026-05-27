import { expect, type Page } from "@playwright/test"
import {
  E2E_IMPORT_PAST_YEAR,
  INCOME_IMPORTER_DRAFT_KEY,
} from "../fixtures/income-importer-e2e-constants"
import { signInWithE2eEmail } from "./auth-email"

export function monthGridLabel(year: number, month: number): string {
  const d = new Date(year, month - 1, 1)
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

export function currentMonthGridLabel(now = new Date()): string {
  return monthGridLabel(now.getUTCFullYear(), now.getUTCMonth() + 1)
}

export async function signInAndOpenSettings(
  page: Page,
  origin: string,
  email: string,
): Promise<void> {
  await page.context().clearCookies()
  await signInWithE2eEmail(page, origin, email)
  await page.goto(`${origin}/#/settings/savings-tracking`)
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 90_000 })
  await expect(page.getByRole("button", { name: "Add past income" })).toBeVisible({
    timeout: 30_000,
  })
}

export async function openIncomeImporterDialog(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Add past income" }).click()
  const dialog = page.getByRole("dialog", { name: "Add past income" })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator("#calendar-year")).toBeVisible()
}

export async function closeIncomeImporterDialog(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Add past income" })
  await dialog.getByRole("button", { name: "Close" }).click()
  await expect(dialog).not.toBeVisible()
}

export const INCOME_CELL_EDIT_DIALOG = "Edit past income"

export async function setScrollYear(page: Page, year: number): Promise<void> {
  const yearSelect = page.locator("#calendar-year")
  await expect.poll(async () => {
    await yearSelect.selectOption(String(year))
    return yearSelect.inputValue()
  }).toBe(String(year))
  await expect(page.getByRole("rowheader", { name: String(year), exact: true })).toBeVisible()
}

export async function fillPaintBar(
  page: Page,
  amount: number,
  source: string,
): Promise<void> {
  await page.locator("#paint-amount").fill(String(amount))
  await page.locator("#paint-source").fill(source)
  await page.locator("#paint-source").blur()
  await expect(page.locator("#paint-source")).toHaveValue(source)
}

export async function expectReviewImportEnabled(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Review" })).toBeEnabled()
}

export async function paintMonthCell(page: Page, monthLabel: string): Promise<void> {
  const cell = page.getByRole("gridcell", { name: new RegExp(`^${monthLabel}`, "i") })
  await cell.scrollIntoViewIfNeeded()
  await cell.click()
}

export async function paintMonthRange(
  page: Page,
  startLabel: string,
  endLabel: string,
): Promise<void> {
  const start = page.getByRole("gridcell", { name: new RegExp(`^${startLabel}`, "i") })
  const end = page.getByRole("gridcell", { name: new RegExp(`^${endLabel}`, "i") })
  await start.scrollIntoViewIfNeeded()
  await end.scrollIntoViewIfNeeded()
  const startBox = await start.boundingBox()
  const endBox = await end.boundingBox()
  if (!startBox || !endBox) {
    throw new Error(`Could not locate calendar cells for ${startLabel} → ${endLabel}`)
  }
  await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2)
  await page.mouse.up()
}

export async function openCellEdit(page: Page, monthLabel: string): Promise<void> {
  const cell = page.getByRole("gridcell", { name: new RegExp(`^${monthLabel}`, "i") })
  await cell
    .getByRole("button", { name: new RegExp(`Edit ${monthLabel}`, "i") })
    .click({ force: true })
  await expect(page.getByRole("dialog", { name: INCOME_CELL_EDIT_DIALOG })).toBeVisible()
}

export function cellEditDialog(page: Page) {
  return page.getByRole("dialog", { name: INCOME_CELL_EDIT_DIALOG })
}

export async function waitForImporterDraftEntries(page: Page, minEntries: number): Promise<void> {
  await expect
    .poll(async () => {
      return page.evaluate((key) => {
        const raw = sessionStorage.getItem(key)
        if (!raw) return 0
        try {
          const parsed = JSON.parse(raw) as { entries?: unknown[] }
          return Array.isArray(parsed.entries) ? parsed.entries.length : 0
        } catch {
          return 0
        }
      }, INCOME_IMPORTER_DRAFT_KEY)
    })
    .toBeGreaterThanOrEqual(minEntries)
}

/** Fill paint bar, scroll to year, then drag-select an inclusive month range. */
export async function paintDefaultPastRange(page: Page): Promise<void> {
  await fillPaintBar(page, 5000, "E2E Employer")
  await setScrollYear(page, E2E_IMPORT_PAST_YEAR)
    await paintMonthRange(
    page,
    monthGridLabel(E2E_IMPORT_PAST_YEAR, 1),
    monthGridLabel(E2E_IMPORT_PAST_YEAR, 3),
  )
  await expectReviewImportEnabled(page)
}
