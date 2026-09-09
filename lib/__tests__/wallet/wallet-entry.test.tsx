import { JSDOM } from "jsdom"
import { act, type ComponentProps } from "react"
import { cleanup, fireEvent, render } from "@testing-library/react"
import { chromium } from "@playwright/test"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import WalletEntry from "@/components/wallet/wallet-entry"
import WalletSetup from "@/components/wallet/wallet-setup"
import * as http from "@/lib/wallet/client-http"

const context = vi.hoisted(() => ({ getPrivacyKey: () => null }))
vi.mock("@/lib/app-context", () => ({ useApp: () => context }))
vi.mock("next/dynamic", () => ({ default: () => function LazySetup(props: ComponentProps<typeof WalletSetup>) { return <WalletSetup {...props} /> } }))

let dom: JSDOM
beforeAll(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:3001" })
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, sessionStorage: dom.window.sessionStorage, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true })) vi.stubGlobal(key, value)
})
beforeEach(() => {
  window.localStorage.clear(); sessionStorage.clear()
  vi.spyOn(http, "walletRequest").mockResolvedValue({ creationAvailable: true, network: "regtest", hasCredential: false, wallets: [] })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
afterAll(() => { dom.window.close(); vi.unstubAllGlobals() })

async function setupWorkspace() {
  const view = render(<WalletEntry userId="layout-fixture" visible />)
  await act(async () => {})
  fireEvent.click(view.getByRole("button", { name: "Create wallet" }))
  fireEvent.click(view.getByRole("button", { name: "Continue to protection" }))
  return view
}

describe("wallet workspace layout", () => {
  it("places setup and workspace tiles in separate desktop columns without stretching tiles", async () => {
    const view = await setupWorkspace()
    const options = view.getByRole("complementary", { name: "Wallet workspace options" })
    const layout = options.parentElement!
    expect(layout).toHaveClass("grid", "items-start", "lg:grid-cols-2")
    expect(view.getByLabelText("Confirm recovery password").closest("[data-wallet-setup]")?.parentElement).toBe(layout)
    expect(view.getByRole("banner")).toHaveClass("col-span-full")
    expect(options).toContainElement(view.getByRole("switch", { name: "Remember this wallet workspace" }))
    expect(options).toHaveClass("min-w-0", "flex-col", "gap-5")
    const input = view.getByLabelText("Confirm recovery password")
    view.rerender(<WalletEntry userId="layout-fixture" visible />)
    expect(view.getByLabelText("Confirm recovery password")).toBe(input)
  })

  it("keeps the overview full width", async () => {
    const view = render(<WalletEntry userId="layout-fixture" visible />)
    await act(async () => {})
    const layout = view.getByRole("complementary", { name: "Wallet workspace options" }).parentElement!
    expect(layout).not.toHaveClass("lg:grid-cols-2")
  })

  it.skipIf(process.env.WALLET_LAYOUT_BROWSER !== "true")("lays out the rendered setup with real app CSS at mobile and desktop widths", async () => {
    const view = await setupWorkspace()
    const markup = view.container.innerHTML
    view.unmount()
    const browser = await chromium.launch({ headless: true, executablePath: process.env.WALLET_PLAYWRIGHT_CHROMIUM || undefined })
    try {
      const page = await browser.newPage()
      await page.goto("http://localhost:3001/faq", { waitUntil: "networkidle" })
      const styles = await page.locator('link[rel="stylesheet"]').evaluateAll(links => links.map(link => (link as HTMLLinkElement).href))
      expect(styles.length).toBeGreaterThan(0)
      await page.setContent(`<html class="dark"><head>${styles.map(href => `<link rel="stylesheet" href="${href}">`).join("")}</head><body><main class="p-4 lg:ml-56">${markup}</main></body></html>`, { waitUntil: "networkidle" })
      for (const width of [320, 390, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 1000 })
        const setup = (await page.locator("[data-wallet-setup]").boundingBox())!
        const options = (await page.getByRole("complementary", { name: "Wallet workspace options" }).boundingBox())!
        const input = (await page.getByLabel("Confirm recovery password").boundingBox())!
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        expect(input.width).toBeLessThan(setup.width)
        if (width >= 1024) {
          expect(options.x).toBeGreaterThan(setup.x + setup.width)
          expect(Math.abs(options.y - setup.y)).toBeLessThan(2)
          expect(Math.abs(options.width - setup.width)).toBeLessThan(2)
          expect(options.height).toBeLessThan(setup.height)
        } else {
          expect(options.y).toBeGreaterThan(setup.y + setup.height)
          expect(Math.abs(options.x - setup.x)).toBeLessThan(2)
        }
      }
    } finally { await browser.close() }
  }, 60000)
})
