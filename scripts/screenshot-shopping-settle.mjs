/**
 * Full shared-shopping settlement demo:
 * create group → invite/join → requests → receipt → tab → envelope posts → payment → $0.
 */
import { createRequire } from "node:module"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { waitForDialogSettled } from "./lib/playwright-screenshot-helpers.mjs"

const require = createRequire(import.meta.url)
const playwrightPkg = path.dirname(
  require.resolve("playwright/package.json", {
    paths: ["/workspace/node_modules/.pnpm/playwright@1.59.1/node_modules"],
  }),
)
const playwrightMod = await import(pathToFileURL(path.join(playwrightPkg, "index.js")).href)
const chromium = playwrightMod.chromium ?? playwrightMod.default?.chromium
if (!chromium) throw new Error("Could not load playwright chromium")

const ORIGIN = process.env.ORIGIN || "http://localhost:3001"
const OUT = process.env.OUT_DIR || "/opt/cursor/artifacts"
const OWNER = "shopping-owner@bitbudget.test"
const MEMBER = "shopping-member@bitbudget.test"
const CODE = "424242"
const PIN = "4242"
const NOTES = []

function note(msg) {
  console.log(msg)
  NOTES.push(msg)
}

async function expectEnabled(locator, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await locator.isEnabled().catch(() => false)) return
    await locator.page().waitForTimeout(200)
  }
  throw new Error("Control stayed disabled")
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: file, fullPage: false })
  note(`saved ${file}`)
  return file
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
  await page.getByPlaceholder("000000").waitFor({ state: "visible", timeout: 20_000 })
  await page.getByPlaceholder("000000").fill(CODE)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 30_000 })
}

async function dismissChrome(page) {
  await page.keyboard.press("Escape").catch(() => {})
  for (const name of [/Remind me later/i, /Hide from Home/i, /Got it/i, /Dismiss/i]) {
    const btn = page.getByRole("button", { name }).first()
    if (await btn.isVisible().catch(() => false)) await btn.click({ force: true }).catch(() => {})
  }
}

async function unlock(page) {
  const pin = page.getByPlaceholder("Enter your passphrase")
  const shell = page.getByRole("button", { name: "TRANSACTIONS" })
  // Seeded shopping users always need a passphrase once per browser context.
  try {
    await pin.waitFor({ state: "visible", timeout: 20_000 })
    await pin.fill(PIN)
    await page.getByRole("button", { name: "Unlock" }).click()
  } catch {
    // Already unlocked in this context
  }
  await shell.waitFor({ state: "visible", timeout: 90_000 })
  if (await pin.isVisible().catch(() => false)) {
    await pin.fill(PIN)
    await page.getByRole("button", { name: "Unlock" }).click()
    await pin.waitFor({ state: "hidden", timeout: 30_000 })
  }
  await page.waitForTimeout(1000)
  await dismissChrome(page)
}

async function goShopping(page) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await dismissChrome(page)
    await page.evaluate(() => {
      location.hash = "#/shopping"
    })
    try {
      await page.getByRole("button", { name: "Create group" }).waitFor({ state: "visible", timeout: 10_000 })
      await page.getByRole("button", { name: "Create group" }).waitFor({ state: "attached" })
      // Encryption ready → CTA enabled
      const deadline = Date.now() + 15_000
      while (Date.now() < deadline) {
        if (await page.getByRole("button", { name: "Create group" }).isEnabled()) return
        await page.waitForTimeout(250)
      }
      return
    } catch {
      await page.waitForTimeout(500)
    }
  }
  throw new Error("Could not open Shopping hub")
}

async function openGroup(page, name = "Household groceries") {
  await goShopping(page)
  await page.getByText(name).first().waitFor({ state: "visible", timeout: 20_000 })
  await page.getByText(name).first().click()
  await page.getByRole("tab", { name: /Requests/i }).waitFor({ state: "visible", timeout: 20_000 })
}

async function enableBudgetPosting(page, who) {
  const card = page.locator("section").filter({ hasText: "Your budget" }).first()
  await card.waitFor({ state: "visible", timeout: 15_000 })
  // Envelope + catch-up must be set BEFORE enabling — save(true) rejects an empty envelope.
  await card.locator("select").selectOption({ label: "Groceries" })
  const catchUp = card.locator("#shopping-budget-catchup")
  if (!(await catchUp.isChecked())) await catchUp.click()
  await page.waitForTimeout(200)
  const enable = card.locator("#shopping-budget-enabled")
  if (!(await enable.isChecked())) {
    await enable.click()
    await page.waitForTimeout(900)
  }
  const save = card.getByRole("button", { name: "Save" })
  if (await save.isVisible().catch(() => false)) {
    await save.click()
    await page.waitForTimeout(900)
  }
  // Wait for pending rows (catch-up of prior receipt/payment)
  for (let i = 0; i < 12; i++) {
    const pending = card.getByRole("button", { name: "Add" })
    if ((await pending.count()) > 0) break
    if (await card.getByText(/Nothing new to add/i).isVisible().catch(() => false)) break
    await page.waitForTimeout(500)
  }
  await shot(page, `shopping_settle_${who}_budget_pending`)
  for (let i = 0; i < 8; i++) {
    const add = card.getByRole("button", { name: "Add" }).first()
    if (!(await add.isVisible().catch(() => false))) break
    if (!(await add.isEnabled().catch(() => false))) break
    await add.click()
    await page.waitForTimeout(1000)
  }
  await page.waitForTimeout(500)
  const err = await card.locator(".text-destructive, [class*=destructive]").first().textContent().catch(() => null)
  if (err) note(`${who}: budget card error: ${err}`)
  const cardText = await card.innerText()
  note(`${who}: budget card after post: ${cardText.replace(/\s+/g, " ").slice(0, 220)}`)
  await shot(page, `shopping_settle_${who}_budget_posted`)
}

async function openTransactions(page) {
  await page.getByRole("button", { name: "TRANSACTIONS" }).click()
  await page.waitForTimeout(1200)
  // Prefer Groceries filter chip/pill if present
  const groceries = page.getByRole("button", { name: /^Groceries$/ }).first()
  if (await groceries.isVisible().catch(() => false)) {
    await groceries.click()
    await page.waitForTimeout(600)
  }
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
  const ownerCtx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ["clipboard-read", "clipboard-write"],
  })
  const memberCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const owner = await ownerCtx.newPage()
  const member = await memberCtx.newPage()
  owner.setDefaultTimeout(30_000)
  member.setDefaultTimeout(30_000)

  // --- 1. Owner creates group ---
  await signIn(owner, OWNER)
  await unlock(owner)
  await goShopping(owner)
  await owner.getByRole("button", { name: "Create group" }).click()
  await owner.getByPlaceholder("e.g. Apartment groceries").fill("Household groceries")
  await owner.getByPlaceholder("e.g. Sam").fill("Alex")
  await owner.getByPlaceholder("What is this group for? (optional)").fill("Weekly shared shopping")
  await owner.getByRole("button", { name: /^Create group/ }).click()
  await owner.getByRole("heading", { name: "Household groceries" }).waitFor({ state: "visible" })
  await shot(owner, "shopping_settle_01_group_created")

  // Invite
  await owner.getByRole("tab", { name: "Members" }).click()
  await owner.getByRole("button", { name: "Add member" }).click()
  await owner.getByRole("button", { name: "Create invite link" }).click()
  await owner.locator("p.break-all.font-mono").waitFor({ state: "visible" })
  const inviteUrl = (await owner.locator("p.break-all.font-mono").innerText()).trim()
  note(`invite: ${inviteUrl.slice(0, 72)}…`)
  await shot(owner, "shopping_settle_02_invite_link")
  await owner.getByRole("dialog").getByRole("button", { name: "Close" }).first().click()

  // --- 2. Member joins ---
  await signIn(member, MEMBER)
  await unlock(member)
  await member.goto(inviteUrl, { waitUntil: "networkidle" })
  if (await member.getByPlaceholder("Enter your passphrase").isVisible().catch(() => false)) {
    await unlock(member)
  }
  await member.getByText("You have a shopping invite").waitFor({ state: "visible", timeout: 30_000 })
  await member.getByPlaceholder("e.g. Alex").fill("Sam")
  await member.getByRole("button", { name: /Send join request/i }).click()
  await member.getByText(/Request sent|code/i).first().waitFor({ state: "visible", timeout: 20_000 })
  await shot(member, "shopping_settle_03_member_join_sent")  // Owner approves
  await openGroup(owner)
  await owner.getByRole("tab", { name: "Members" }).click()
  const review = owner.locator("main").getByRole("button", { name: "Review", exact: true })
  await review.waitFor({ state: "visible", timeout: 30_000 })
  await review.click()
  const approveDialog = owner.getByRole("dialog")
  await approveDialog.getByRole("heading", { name: /Let .+ join/i }).waitFor({ state: "visible" })
  const compared = approveDialog.getByRole("switch", { name: /I compared this with them/i })
  await compared.click()
  await owner.waitForTimeout(300)
  if (!(await compared.isChecked())) await compared.click({ force: true })
  const addToGroup = approveDialog.getByRole("button", { name: /Add to group/i })
  await addToGroup.waitFor({ state: "visible" })
  await expectEnabled(addToGroup, 10_000)
  await addToGroup.click()
  await owner.locator("main").getByText("Sam").waitFor({ state: "visible", timeout: 20_000 })
  await shot(owner, "shopping_settle_04_members_ready")

  // --- 3. Member adds Coffee beans request ---
  await openGroup(member)
  await member.getByRole("tab", { name: /Requests/i }).click()
  await member.getByRole("button", { name: /Add a request/i }).click()
  await member.getByPlaceholder("e.g. Greek yogurt").fill("Coffee beans")
  await member.getByRole("dialog").getByRole("button", { name: /Add|Save|Create/i }).last().click()
  await member.getByText("Coffee beans").waitFor({ state: "visible", timeout: 15_000 })
  await shot(member, "shopping_settle_05_request_coffee")

  // Owner also adds a general item for richer list
  await openGroup(owner)
  await owner.getByRole("tab", { name: /Requests/i }).click()
  await owner.getByRole("button", { name: /Add a request/i }).click()
  await owner.getByPlaceholder("e.g. Greek yogurt").fill("Oat milk")
  await owner.getByRole("dialog").getByRole("button", { name: /Add|Save|Create/i }).last().click()
  await owner.getByText("Oat milk").waitFor({ state: "visible" })
  // Wait for Coffee beans from Sam to appear (poll/reload)
  for (let i = 0; i < 10; i++) {
    if (await owner.getByText("Coffee beans").isVisible().catch(() => false)) break
    await owner.waitForTimeout(2000)
    await openGroup(owner)
  }
  await shot(owner, "shopping_settle_06_requests_both")

  // --- 4. Owner shops: $40 receipt, $12 coffee matched to Sam ---
  await owner.getByRole("tab", { name: /Receipts/i }).click()
  await owner.getByRole("button", { name: /Add receipt/i }).click()
  await waitForDialogSettled(owner)
  const receipt = owner.getByRole("dialog")
  await receipt.getByPlaceholder("e.g. Trader Joe's").fill("Trader Joe's")
  // Total field — first $0.00 placeholder in dialog is Total
  await receipt.getByPlaceholder("$0.00").first().fill("40.00")
  await receipt.getByRole("button", { name: "Add item" }).click()
  await receipt.getByLabel("Item name").fill("Coffee beans")
  await receipt.getByLabel("Item amount").fill("12.00")
  // Match to Sam's request if not auto-matched
  const whoSelect = receipt.locator("select").first()
  const options = await whoSelect.locator("option").allTextContents()
  const coffeeOpt = options.find((t) => /Coffee beans/i.test(t))
  if (coffeeOpt) {
    const value = await whoSelect.locator("option", { hasText: coffeeOpt }).first().getAttribute("value")
    if (value) await whoSelect.selectOption(value)
  }
  await shotDialog(owner, "shopping_settle_07_receipt_draft")
  await receipt.getByRole("button", { name: /Save and split/i }).click()
  await owner.getByText("Trader Joe's").waitFor({ state: "visible", timeout: 20_000 })
  await shot(owner, "shopping_settle_08_receipt_saved")

  // --- 5. Tab balances before payment ---
  await owner.getByRole("tab", { name: "Tab", exact: true }).click()
  await owner.getByText(/Net owed to you|\$26/).first().waitFor({ state: "visible", timeout: 15_000 })
  const ownerTabText = await owner.locator("main").innerText()
  note(`owner tab snippet: ${ownerTabText.match(/Net owed to you[\s\S]{0,40}/)?.[0] ?? ownerTabText.slice(0, 200)}`)
  await shot(owner, "shopping_settle_09_owner_tab_26")

  await openGroup(member)
  await member.getByRole("tab", { name: "Tab", exact: true }).click()
  await member.getByText(/You owe|\$26/).first().waitFor({ state: "visible", timeout: 15_000 })
  await shot(member, "shopping_settle_10_member_tab_26")

  // --- 6. Envelope posting (both) ---
  await openGroup(owner)
  await enableBudgetPosting(owner, "owner")
  await openGroup(member)
  await enableBudgetPosting(member, "member")

  // Owner transactions in Groceries
  await openTransactions(owner)
  await shot(owner, "shopping_settle_11_owner_transactions")
  const ownerTxnText = await owner.locator("main").innerText()
  note(`owner txns contain Trader: ${/Trader/i.test(ownerTxnText)}; snippet: ${ownerTxnText.replace(/\s+/g, " ").slice(0, 280)}`)

  await openTransactions(member)
  await shot(member, "shopping_settle_12_member_transactions")
  const memberTxnText = await member.locator("main").innerText()
  note(`member txns contain Trader: ${/Trader/i.test(memberTxnText)}; snippet: ${memberTxnText.replace(/\s+/g, " ").slice(0, 280)}`)
  // --- 7. Member records $26 payment ---
  await openGroup(member)
  await member.getByRole("tab", { name: "Tab", exact: true }).click()
  await member.getByRole("button", { name: /Record payment/i }).click()
  await waitForDialogSettled(member)
  const pay = member.getByRole("dialog")
  await pay.getByPlaceholder("$0.00").fill("26.00")
  // Ensure "I paid them" is on if present
  const iPaid = pay.getByText(/I paid them/i)
  if (await iPaid.isVisible().catch(() => false)) {
    const sw = pay.getByRole("switch").first()
    if (await sw.isVisible().catch(() => false) && !(await sw.isChecked())) await sw.click()
  }
  await shotDialog(member, "shopping_settle_13_payment_dialog")
  await pay.getByRole("button", { name: /Record payment/i }).click()
  await member.waitForTimeout(1200)
  await shot(member, "shopping_settle_14_member_tab_settled")

  // Owner tab should be $0
  await openGroup(owner)
  await owner.getByRole("tab", { name: "Tab", exact: true }).click()
  await owner.waitForTimeout(1000)
  // Soft reload if needed
  for (let i = 0; i < 8; i++) {
    const text = await owner.locator("main").innerText()
    if (/\$0\.00|settled|All square|even/i.test(text) || !/\$26/.test(text)) break
    await owner.waitForTimeout(1500)
    await openGroup(owner)
    await owner.getByRole("tab", { name: "Tab", exact: true }).click()
  }
  await shot(owner, "shopping_settle_15_owner_tab_settled")
  const settledOwner = await owner.locator("main").innerText()
  note(`owner settled tab has $26: ${/\$26/.test(settledOwner)}`)
  note(`owner settled tab has $0: ${/\$0\.00/.test(settledOwner)}`)

  // Member posts repayment row if it appeared after payment
  await openGroup(member)
  await enableBudgetPosting(member, "member_after_pay")

  await openTransactions(member)
  await shot(member, "shopping_settle_16_member_transactions_final")
  note(`member final txns: ${(await member.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 320)}`)

  await openTransactions(owner)
  await shot(owner, "shopping_settle_17_owner_transactions_final")
  note(`owner final txns: ${(await owner.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 320)}`)

  await owner.getByRole("button", { name: "ENVELOPES" }).click()
  await owner.waitForTimeout(1000)
  await shot(owner, "shopping_settle_18_owner_envelopes")
  note(`owner envelopes: ${(await owner.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 280)}`)

  await member.getByRole("button", { name: "ENVELOPES" }).click()
  await member.waitForTimeout(1000)
  await shot(member, "shopping_settle_19_member_envelopes")
  note(`member envelopes: ${(await member.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 280)}`)

  await writeFile(path.join(OUT, "shopping_settle_notes.txt"), NOTES.join("\n") + "\n")
  await browser.close()
  note("done")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
