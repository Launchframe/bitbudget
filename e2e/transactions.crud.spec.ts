import "./load-env"
import { test, expect, request, type Locator, type Page } from "@playwright/test"
import { prisma } from "../lib/db"
import {
  E2E_TRANSACTION_CRUD_BIMONTHLY_EMAIL,
  E2E_TRANSACTION_CRUD_MONTHLY_EMAIL,
} from "./fixtures/transaction-crud-e2e-constants"
import { signInWithE2eEmail } from "./helpers/auth-email"
import { fetchJsonInPage } from "./helpers/page-api"
import { installTestClock } from "./helpers/test-clock"

interface TransactionCrudState {
  dbHost: string | null
  user: {
    email: string | null
    monthlyIncome: number
    payCadence: string
  }
  envelopes: Array<{
    id: string
    name: string
    monthlyAllotment: number
    balance: number
  }>
  transactions: Array<{
    payee: string
    amount: number
    type: string
    date: string
    tags: string[]
    notes: string | null
    envelopeName: string
    recurringId: string | null
  }>
  recurring: Array<{
    payee: string
    amount: number
    cadence: string
    nextDueDate: string
    active: boolean
  }>
  shortcuts: Array<{
    payee: string
    defaultAmount: number | null
    usageCount: number
  }>
}

function originFromBaseURL(baseURL: string | undefined): string {
  return baseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:3100"
}

async function resetSeed(baseURL: string | undefined): Promise<void> {
  const ctx = await request.newContext({ baseURL: originFromBaseURL(baseURL) })
  try {
    const res = await ctx.post("/api/e2e/reset-transaction-crud-seed", {
      headers: { "Content-Type": "application/json" },
      data: "{}",
    })
    expect(res.ok(), await res.text()).toBeTruthy()
  } finally {
    await ctx.dispose()
  }
}

async function stateFor(page: Page, email: string, asOf: string): Promise<TransactionCrudState> {
  const res = await fetchJsonInPage(page, `/api/e2e/transaction-crud-state?email=${encodeURIComponent(email)}&asOf=${asOf}`)
  expect(res.status, JSON.stringify(res.json)).toBe(200)
  return res.json as unknown as TransactionCrudState
}

async function openTransactions(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/#/transactions`)
  await expect(page.getByRole("heading", { name: "All Transactions" })).toBeVisible({ timeout: 90_000 })
  await page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500))
  })
}

async function chooseEnvelope(page: Page, name: string, trigger?: Locator): Promise<void> {
  await (trigger ?? page.getByRole("combobox").filter({ hasText: "Select an envelope" })).click()
  await page.getByRole("option", { name }).click()
}

async function addTag(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Tags" }).click()
  await page.getByPlaceholder("Add new tag...").fill(name)
  await page.keyboard.press("Enter")
  await page.getByRole("button", { name: "Done" }).click()
}

async function createTransaction(page: Page, input: {
  payee: string
  amount: string
  envelope: string
  date: string
  notes?: string
  tag?: string
  saveAsShortcut?: boolean
  recurring?: { cadence: string }
}): Promise<void> {
  await page.getByRole("button", { name: "New Transaction" }).first().click()
  await expect(page.getByRole("heading", { name: "New Transaction" })).toBeVisible()
  await page.locator("#payee").fill(input.payee)
  await page.locator("#amount").fill(input.amount)
  await chooseEnvelope(page, input.envelope)
  await page.locator("#date").fill(input.date)
  if (input.notes) await page.locator("#notes").fill(input.notes)
  if (input.tag) await addTag(page, input.tag)
  if (input.recurring) {
    await page.getByRole("button", { name: /Recurring/ }).click()
    await page.getByLabel("Enable Recurring").click()
    await page.getByRole("combobox").click()
    await page.getByRole("option", { name: input.recurring.cadence }).click()
    await page.getByRole("button", { name: "Done" }).click()
  }
  if (input.saveAsShortcut) {
    await page.getByLabel("Save as shortcut").check()
  }
  await page.getByRole("button", { name: input.recurring ? "Add Recurring Expense" : "Add Expense" }).click()
  await expect(page.getByRole("heading", { name: "New Transaction" })).toBeHidden({ timeout: 30_000 })
}

test.describe("Transaction CRUD, shortcuts, recurring, and envelope refill cadence", () => {
  test.afterAll(async () => {
    await prisma.$disconnect()
  })

  test.beforeEach(async ({ baseURL }) => {
    await resetSeed(baseURL)
  })

  test("covers one-time transaction CRUD, tags, and quick transactions", async ({ page, baseURL }) => {
    const origin = originFromBaseURL(baseURL)
    await installTestClock(page, "2026-04-10T12:00:00Z")
    await signInWithE2eEmail(page, origin, E2E_TRANSACTION_CRUD_MONTHLY_EMAIL)
    await openTransactions(page, origin)

    await createTransaction(page, {
      payee: "E2E Grocery Run",
      amount: "42.50",
      envelope: "E2E Groceries",
      date: "2026-04-10",
      notes: "Weekly staples",
      tag: "errands",
      saveAsShortcut: true,
    })

    await expect(page.getByText("E2E Grocery Run").first()).toBeVisible()
    let state = await stateFor(page, E2E_TRANSACTION_CRUD_MONTHLY_EMAIL, "2026-04-10")
    expect(state.transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payee: "E2E Grocery Run",
          amount: 42.5,
          type: "expense",
          date: "2026-04-10",
          tags: ["errands"],
          notes: "Weekly staples",
          envelopeName: "E2E Groceries",
        }),
      ]),
    )
    expect(state.shortcuts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ payee: "E2E Grocery Run", defaultAmount: 42.5, usageCount: 0 }),
      ]),
    )
    expect(state.envelopes.find((e) => e.name === "E2E Groceries")?.balance).toBe(457.5)

    await page.getByText("E2E Grocery Run").first().click()
    await page.getByRole("button", { name: "Edit" }).click()
    await page.locator("#edit-transaction-payee").fill("E2E Grocery Run Edited")
    await page.locator("#edit-transaction-amount").fill("50")
    await page.locator("#edit-transaction-date").fill("2026-04-11")
    await page.locator("#edit-transaction-notes").fill("Weekly staples and fruit")
    await page.getByRole("button", { name: "Save Changes" }).click()
    await expect(page.getByText("E2E Grocery Run Edited").first()).toBeVisible()

    state = await stateFor(page, E2E_TRANSACTION_CRUD_MONTHLY_EMAIL, "2026-04-11")
    expect(state.transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payee: "E2E Grocery Run Edited",
          amount: 50,
          date: "2026-04-11",
          tags: ["errands"],
          notes: "Weekly staples and fruit",
        }),
      ]),
    )
    expect(state.envelopes.find((e) => e.name === "E2E Groceries")?.balance).toBe(450)

    await page.getByRole("button", { name: "New Transaction" }).first().click()
    await page.getByRole("button", { name: /E2E Grocery Run/ }).click()
    await page.getByRole("button", { name: "Add Expense" }).click()
    await expect(page.getByText("E2E Grocery Run", { exact: true }).first()).toBeVisible()

    state = await stateFor(page, E2E_TRANSACTION_CRUD_MONTHLY_EMAIL, "2026-04-11")
    expect(state.shortcuts.find((s) => s.payee === "E2E Grocery Run")?.usageCount).toBe(1)
    expect(state.transactions.filter((txn) => txn.payee === "E2E Grocery Run")).toHaveLength(1)

    await page.getByText("E2E Grocery Run Edited").first().click()
    await page.getByRole("button", { name: "Delete" }).click()
    await expect(page.getByText("E2E Grocery Run Edited")).toBeHidden({ timeout: 30_000 })

    state = await stateFor(page, E2E_TRANSACTION_CRUD_MONTHLY_EMAIL, "2026-04-11")
    expect(state.transactions.some((txn) => txn.payee === "E2E Grocery Run Edited")).toBe(false)
    expect(state.transactions.some((txn) => txn.payee === "E2E Grocery Run")).toBe(true)
  })

  test("processes recurring transactions after advancing the test clock and refills monthly envelopes", async ({ page, baseURL }) => {
    const origin = originFromBaseURL(baseURL)
    await installTestClock(page, "2026-04-10T12:00:00Z")
    await signInWithE2eEmail(page, origin, E2E_TRANSACTION_CRUD_MONTHLY_EMAIL)
    await openTransactions(page, origin)

    await createTransaction(page, {
      payee: "E2E Monthly Rent",
      amount: "300",
      envelope: "E2E Rent",
      date: "2026-04-10",
      tag: "housing",
      recurring: { cadence: "Monthly" },
    })
    await expect(page.getByText("E2E Monthly Rent").first()).toBeVisible()
    await expect(page.getByText("Upcoming Recurring", { exact: false })).toBeVisible()

    let state = await stateFor(page, E2E_TRANSACTION_CRUD_MONTHLY_EMAIL, "2026-04-10")
    expect(state.envelopes.find((e) => e.name === "E2E Rent")?.balance).toBe(900)
    expect(state.recurring).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ payee: "E2E Monthly Rent", cadence: "monthly", nextDueDate: "2026-05-10" }),
      ]),
    )

    await page.evaluate(async () => {
      await fetch("/api/recurring/process", { method: "POST", credentials: "include" })
    })
    state = await stateFor(page, E2E_TRANSACTION_CRUD_MONTHLY_EMAIL, "2026-04-10")
    expect(state.transactions.filter((txn) => txn.payee === "E2E Monthly Rent")).toHaveLength(1)

    await installTestClock(page, "2026-05-10T12:00:00Z")
    const processed = await fetchJsonInPage(page, "/api/e2e/transaction-crud-state", {
      method: "POST",
      body: { email: E2E_TRANSACTION_CRUD_MONTHLY_EMAIL, asOf: "2026-05-10" },
    })
    expect(processed.status, JSON.stringify(processed.json)).toBe(200)
    expect(processed.json?.processed).toBe(1)

    state = await stateFor(page, E2E_TRANSACTION_CRUD_MONTHLY_EMAIL, "2026-05-10")
    expect(state.transactions.filter((txn) => txn.payee === "E2E Monthly Rent")).toHaveLength(2)
    expect(state.recurring.find((r) => r.payee === "E2E Monthly Rent")?.nextDueDate).toBe("2026-06-10")
    expect(state.envelopes.find((e) => e.name === "E2E Rent")?.balance).toBe(900)
  })

  test("refills twice-monthly envelopes on the second paycheck date", async ({ page, baseURL }) => {
    const origin = originFromBaseURL(baseURL)
    await installTestClock(page, "2026-04-10T12:00:00Z")
    await signInWithE2eEmail(page, origin, E2E_TRANSACTION_CRUD_BIMONTHLY_EMAIL)
    await openTransactions(page, origin)

    let state = await stateFor(page, E2E_TRANSACTION_CRUD_BIMONTHLY_EMAIL, "2026-04-10")
    expect(state.user.payCadence).toBe("bimonthly")
    expect(state.envelopes.find((e) => e.name === "E2E Groceries")?.balance).toBe(250)

    await createTransaction(page, {
      payee: "E2E First Paycheck Groceries",
      amount: "75",
      envelope: "E2E Groceries",
      date: "2026-04-10",
    })
    state = await stateFor(page, E2E_TRANSACTION_CRUD_BIMONTHLY_EMAIL, "2026-04-10")
    expect(state.envelopes.find((e) => e.name === "E2E Groceries")?.balance).toBe(175)

    await installTestClock(page, "2026-04-15T12:00:00Z")
    await page.reload()
    await expect(page.getByRole("heading", { name: "All Transactions" })).toBeVisible({ timeout: 90_000 })
    state = await stateFor(page, E2E_TRANSACTION_CRUD_BIMONTHLY_EMAIL, "2026-04-15")
    expect(state.envelopes.find((e) => e.name === "E2E Groceries")?.balance).toBe(425)
  })
})
