/**
 * Finish settlement demo from current DB (or create if missing):
 * verify tab → member payment → member envelope repayment → proof screenshots.
 */
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { waitForDialogSettled } from "./lib/playwright-screenshot-helpers.mjs"
import { defaultScreenshotOutDir, loadPlaywrightChromium } from "./lib/playwright-screenshot-runtime.mjs"

const chromium = await loadPlaywrightChromium()
const ORIGIN = process.env.ORIGIN || "http://localhost:3001"
const OUT = defaultScreenshotOutDir()
const NOTES = []
const note = (m) => {
  console.log(m)
  NOTES.push(m)
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: file, fullPage: false })
  note(`saved ${file}`)
}

async function shotDialog(page, name) {
  await waitForDialogSettled(page)
  await shot(page, name)
}

async function signIn(page, email) {
  await page.goto(`${ORIGIN}/auth`, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "Email" }).click()
  await page.getByPlaceholder("you@example.com").fill(email)
  await page.getByRole("button", { name: "Send Login Code" }).click()
  await page.getByPlaceholder("000000").fill("424242")
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30_000 })
}

async function unlock(page) {
  const pin = page.getByPlaceholder("Enter your passphrase")
  try {
    await pin.waitFor({ state: "visible", timeout: 20_000 })
    await pin.fill("4242")
    await page.getByRole("button", { name: "Unlock" }).click()
  } catch {
    /* already unlocked */
  }
  await page.getByRole("button", { name: "TRANSACTIONS" }).waitFor({ state: "visible", timeout: 90_000 })
  await page.waitForTimeout(800)
  await page.keyboard.press("Escape").catch(() => {})
  for (const name of [/Remind me later/i, /Hide from Home/i]) {
    const b = page.getByRole("button", { name }).first()
    if (await b.isVisible().catch(() => false)) await b.click({ force: true }).catch(() => {})
  }
}

async function openGroup(page) {
  await page.evaluate(() => {
    location.hash = "#/shopping"
  })
  await page.getByText("Household groceries").first().waitFor({ state: "visible", timeout: 30_000 })
  await page.getByText("Household groceries").first().click()
  await page.getByRole("tab", { name: /Requests|Tab|Members/i }).first().waitFor({ state: "visible" })
}

async function enableAndAddBudget(page, who) {
  const card = page.locator("section").filter({ hasText: "Your budget" }).first()
  await card.waitFor({ state: "visible" })
  await card.locator("select").selectOption({ label: "Groceries" })
  const catchUp = card.locator("#shopping-budget-catchup")
  if (!(await catchUp.isChecked())) await catchUp.click()
  await page.waitForTimeout(200)
  const enable = card.locator("#shopping-budget-enabled")
  if (!(await enable.isChecked())) {
    await enable.click()
    await page.waitForTimeout(1000)
  }
  const save = card.getByRole("button", { name: "Save" })
  if (await save.isVisible().catch(() => false)) {
    await save.click()
    await page.waitForTimeout(1000)
  }
  await shot(page, `shopping_settle_fin_${who}_budget_pending`)
  for (let i = 0; i < 8; i++) {
    const add = card.getByRole("button", { name: "Add" }).first()
    if (!(await add.isVisible().catch(() => false)) || !(await add.isEnabled().catch(() => false))) break
    await add.click()
    await page.waitForTimeout(1200)
  }
  await shot(page, `shopping_settle_fin_${who}_budget_posted`)
  const cardText = await card.innerText()
  note(`${who} budget captured (hasPosted=${/\bposted\b/i.test(cardText)})`)
}

async function gotoHash(page, hash) {
  await page.evaluate((h) => {
    location.hash = h
  }, hash)
  await page.waitForTimeout(1500)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
  const owner = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
  const member = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()

  await signIn(owner, "shopping-owner@bitbudget.test")
  await unlock(owner)
  await openGroup(owner)
  await owner.getByRole("tab", { name: "Tab", exact: true }).click()
  await shot(owner, "shopping_settle_fin_01_owner_tab_before")
  const ownerTabBefore = await owner.locator("main").innerText()
  note(`owner tab before captured (has26=${/\$26/.test(ownerTabBefore)}, hasNetOwed=${/Net owed/i.test(ownerTabBefore)})`)

  // Ensure owner budget rows posted
  await enableAndAddBudget(owner, "owner")

  // Owner transactions proof
  await gotoHash(owner, "#/transactions")
  await shot(owner, "shopping_settle_fin_02_owner_transactions")
  const ownerTxn = await owner.locator("main").innerText()
  note(`owner transactions captured (hasShoppingRows=${/Shopping/i.test(ownerTxn)})`)

  // Member payment
  await signIn(member, "shopping-member@bitbudget.test")
  await unlock(member)
  await openGroup(member)
  await member.getByRole("tab", { name: "Tab", exact: true }).click()
  await shot(member, "shopping_settle_fin_03_member_tab_before")
  const memberTabBefore = await member.locator("main").innerText()
  note(`member tab before captured (owes26=${/\$26/.test(memberTabBefore)}, youOwe=${/You owe/i.test(memberTabBefore)})`)

  if (/\$26/.test(memberTabBefore)) {
    await member.getByRole("button", { name: /Record payment/i }).click()
    await waitForDialogSettled(member)
    const pay = member.getByRole("dialog")
    await pay.getByPlaceholder("$0.00").fill("26.00")
    await shotDialog(member, "shopping_settle_fin_04_payment_dialog")
    await pay.getByRole("button", { name: /Record payment/i }).click()
    await member.waitForTimeout(1500)
  }

  await member.getByRole("tab", { name: "Tab", exact: true }).click()
  await shot(member, "shopping_settle_fin_05_member_tab_after_pay")
  const memberTabAfter = await member.locator("main").innerText()
  note(
    `member tab after pay captured (showsZero=${/\$0\.00/.test(memberTabAfter)}, stillOwes26=${/\$26/.test(memberTabAfter)})`,
  )

  // Member posts repayment into Groceries
  await enableAndAddBudget(member, "member")

  await gotoHash(member, "#/transactions")
  await shot(member, "shopping_settle_fin_06_member_transactions")
  const memberTxn = await member.locator("main").innerText()
  note(`member transactions captured (hasShoppingRows=${/Shopping/i.test(memberTxn)})`)

  // Owner tab after payment
  await openGroup(owner)
  await owner.getByRole("tab", { name: "Tab", exact: true }).click()
  for (let i = 0; i < 6; i++) {
    const t = await owner.locator("main").innerText()
    if (/\$0\.00/.test(t) && !/\$26/.test(t)) break
    await owner.waitForTimeout(1500)
    await openGroup(owner)
    await owner.getByRole("tab", { name: "Tab", exact: true }).click()
  }
  await shot(owner, "shopping_settle_fin_07_owner_tab_settled")
  const ownerTabSettled = await owner.locator("main").innerText()
  note(`owner tab settled captured (settledZero=${/\$0\.00/.test(ownerTabSettled) && !/\$26/.test(ownerTabSettled)})`)

  await gotoHash(owner, "#/envelopes")
  await shot(owner, "shopping_settle_fin_08_owner_envelopes")
  const ownerEnv = await owner.locator("main").innerText()
  note(`owner envelopes captured (hasGroceries=${/Groceries/i.test(ownerEnv)})`)

  await gotoHash(member, "#/envelopes")
  await shot(member, "shopping_settle_fin_09_member_envelopes")
  const memberEnv = await member.locator("main").innerText()
  note(`member envelopes captured (hasGroceries=${/Groceries/i.test(memberEnv)})`)

  // Envelope detail for Groceries if clickable
  const g = owner.getByText("Groceries").first()
  if (await g.isVisible().catch(() => false)) {
    await g.click()
    await owner.waitForTimeout(1000)
    await shot(owner, "shopping_settle_fin_10_owner_groceries_detail")
    note("owner groceries detail screenshot captured")
  }

  await writeFile(path.join(OUT, "shopping_settle_finish_notes.txt"), NOTES.join("\n") + "\n")
  await browser.close()
  note("done")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
