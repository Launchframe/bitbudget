/**
 * Capture walkthrough screenshots of the shared shopping list feature.
 * Assumes: E2E_TEST=true server on :3001, qa:shopping:seed already run.
 */
import { createRequire } from "node:module"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

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

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: file, fullPage: false })
  console.log("saved", file)
  return file
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

async function unlock(page) {
  const pin = page.getByPlaceholder("Enter your passphrase")
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (await pin.isVisible().catch(() => false)) {
      await pin.fill(PIN)
      await page.getByRole("button", { name: "Unlock" }).click()
      break
    }
    if (await page.getByRole("button", { name: "TRANSACTIONS" }).isVisible().catch(() => false)) break
    await page.waitForTimeout(200)
  }
  await page.getByRole("button", { name: "TRANSACTIONS" }).waitFor({ state: "visible", timeout: 90_000 })
}

async function goShopping(page) {
  await page.evaluate(() => {
    location.hash = "#/shopping"
  })
  await page.getByRole("button", { name: "Create group" }).waitFor({ state: "visible", timeout: 30_000 })
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

  // --- Owner: Shopping hub ---
  await signIn(owner, OWNER)
  await unlock(owner)
  await goShopping(owner)
  await shot(owner, "shopping_hub_empty")

  // --- Create group dialog ---
  await owner.getByRole("button", { name: "Create group" }).click()
  await owner.getByPlaceholder("e.g. Apartment groceries").fill("Household groceries")
  await owner.getByPlaceholder("e.g. Sam").fill("Alex")
  await owner.getByPlaceholder("What is this group for? (optional)").fill("Weekly shared shopping")
  await shot(owner, "shopping_create_group_dialog")
  await owner.getByRole("button", { name: /^Create group/ }).click()

  // Group detail Requests tab
  await owner.getByRole("tab", { name: "Requests" }).waitFor({ state: "visible", timeout: 30_000 })
  await owner.getByRole("heading", { name: "Household groceries" }).waitFor({ state: "visible" })
  await shot(owner, "shopping_group_requests_tab")

  // Members + invite
  await owner.getByRole("tab", { name: "Members" }).click()
  await shot(owner, "shopping_group_members_tab")
  await owner.getByRole("button", { name: "Add member" }).click()
  await owner.getByRole("button", { name: "Create invite link" }).waitFor({ state: "visible" })
  await shot(owner, "shopping_invite_before_create")
  await owner.getByRole("button", { name: "Create invite link" }).click()
  await owner.locator("p.break-all.font-mono").waitFor({ state: "visible", timeout: 20_000 })
  await shot(owner, "shopping_invite_link_created")

  const inviteUrl = (await owner.locator("p.break-all.font-mono").innerText()).trim()
  console.log("inviteUrl", inviteUrl.slice(0, 80) + "…")
  await owner.getByRole("dialog").getByRole("button", { name: "Close" }).first().click()

  // Add a request
  await owner.getByRole("tab", { name: "Requests" }).click()
  await owner.getByRole("button", { name: /Add a request/i }).click()
  const reqDialog = owner.getByRole("dialog")
  await reqDialog.getByPlaceholder("e.g. Greek yogurt").fill("Oat milk")
  await reqDialog.getByRole("button", { name: /Add|Save|Create/i }).last().click()
  await owner.getByText("Oat milk").waitFor({ state: "visible", timeout: 15_000 })
  await shot(owner, "shopping_request_added")

  // Member joins via invite — sign in first, then open invite (matches QA doc)
  await signIn(member, MEMBER)
  await unlock(member)
  await member.goto(inviteUrl, { waitUntil: "domcontentloaded" })
  await member.waitForTimeout(1500)
  if (await member.getByPlaceholder("Enter your passphrase").isVisible().catch(() => false)) {
    await unlock(member)
  }
  // Invite handoff should land on Shopping with banner
  if (!(await member.getByText("You have a shopping invite").isVisible().catch(() => false))) {
    await member.evaluate(() => {
      location.hash = "#/shopping"
    })
    await member.getByText("You have a shopping invite").waitFor({ state: "visible", timeout: 20_000 })
  }
  await shot(member, "shopping_member_invite_banner")
  await member.getByPlaceholder("e.g. Alex").fill("Sam")
  await member.getByRole("button", { name: /Send join request/i }).click()
  await member.getByText(/Request sent|verification|code/i).first().waitFor({ state: "visible", timeout: 20_000 })
  await shot(member, "shopping_member_join_receipt")

  // Owner reviews join request — reload group
  await owner.evaluate(() => {
    location.hash = "#/shopping"
  })
  await owner.getByText("Household groceries").first().waitFor({ state: "visible", timeout: 20_000 })
  await owner.getByText("Household groceries").first().click()
  await owner.getByRole("tab", { name: "Members" }).click()
  const reviewJoin = owner.locator("main").getByRole("button", { name: "Review", exact: true })
  await reviewJoin.waitFor({ state: "visible", timeout: 30_000 })
  await shot(owner, "shopping_join_request_pending")
  await reviewJoin.click()
  await owner.getByRole("button", { name: /Add to group/i }).waitFor({ state: "visible" })
  await shot(owner, "shopping_approve_member_dialog")
  const compareSwitch = owner.getByRole("switch").first()
  if (await compareSwitch.isVisible().catch(() => false)) {
    await compareSwitch.click()
  } else {
    await owner.getByText(/I compared this with them/i).click()
  }
  await owner.getByRole("button", { name: /Add to group/i }).click()
  await owner.locator("main").getByText("Sam").waitFor({ state: "visible", timeout: 20_000 })
  await shot(owner, "shopping_members_after_approve")

  await browser.close()
  console.log("done")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
