import { JSDOM } from "jsdom"
import { renderToStaticMarkup } from "react-dom/server"
import { NextRequest } from "next/server"
import { describe, expect, it, vi } from "vitest"
import FaqPage from "@/app/faq/page"
import middleware from "@/middleware"
import WalletSetup from "@/components/wallet/wallet-setup"

vi.mock("@/lib/auth", () => ({ auth: (handler: unknown) => handler }))
vi.mock("@/lib/app-context", () => ({ useApp: () => ({ getPrivacyKey: () => null }) }))

function faqDocument() {
  return new JSDOM(renderToStaticMarkup(<FaqPage />)).window.document
}

describe("public wallet FAQ", () => {
  it("separates provider support from real BitBudget verification", () => {
    const document = faqDocument()
    expect(document.querySelector("h1")?.textContent).toBe("Frequently asked questions")
    expect(document.querySelector("#passkey-compatibility")?.textContent).toContain("No real passkey manager is listed as verified with BitBudget yet")
    const table = document.querySelector("table")!
    expect(table.querySelector("caption")?.textContent).toContain("Passkey manager compatibility")
    for (const name of ["Bitwarden", "Google Password Manager", "Apple Passwords", "1Password", "Proton Pass", "KeePassXC"]) {
      expect(table.textContent).toContain(name)
    }
    const bitwarden = [...table.querySelectorAll("tbody tr")].find(row => row.textContent?.includes("Bitwarden"))!
    expect(bitwarden.textContent).toContain("Known limitation")
    expect(bitwarden.querySelector("a")?.href).toContain("github.com/bitwarden/clients/blob/")
    expect(document.querySelector("time")?.dateTime).toBe("2026-09-07")
    const rows = [...table.querySelectorAll("tbody tr")]
    const apple = rows.find(row => row.textContent?.includes("Apple Passwords"))!
    expect(apple.textContent).toContain("Documented support")
    expect(apple.textContent).toContain("macOS 15.0")
    expect(rows.find(row => row.textContent?.includes("1Password"))?.textContent).toContain("Unconfirmed")
    for (const row of rows) expect(row.querySelector('a[href^="https://"]')).not.toBeNull()
  })

  it("offers safe troubleshooting without collecting secrets", () => {
    const document = faqDocument()
    for (const id of ["why-passkeys", "passkey-compatibility", "retry-setup", "support-codes", "recovery", "report-compatibility"]) {
      expect(document.getElementById(id)).not.toBeNull()
    }
    expect(document.body.textContent).toContain("Do not delete an existing wallet’s passkey")
    expect(document.body.textContent).toContain("Never share your password, recovery file, private keys, or raw passkey responses")
    expect(document.querySelector("form")).toBeNull()
    for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href^="https://"]')) {
      expect(anchor.rel).toContain("noreferrer")
    }
  })

  it("opens setup help in another tab without leaving the password form", () => {
    const document = new JSDOM(renderToStaticMarkup(<WalletSetup userId="fixture" network="regtest" hasCredential={false} onClose={() => {}} onChanged={() => {}} />)).window.document
    const link = document.querySelector<HTMLAnchorElement>('a[href="/faq#passkey-compatibility"]')!
    expect(link.target).toBe("_blank")
    expect(link.rel).toContain("noopener")
    expect(link.textContent).toContain("opens in a new tab")
  })

  it.each(["/faq", "/faq/"])("allows signed-out access to %s", async path => {
    const response = await middleware(new NextRequest(`https://bitbudget.test${path}`), {} as never)
    expect(response?.headers.get("x-middleware-next")).toBe("1")
  })

  it("keeps private and lookalike nested pages behind authentication", async () => {
    const response = await middleware(new NextRequest("https://bitbudget.test/dashboard/settings"), {} as never)
    expect(response?.headers.get("location")).toBe("https://bitbudget.test/welcome")
    const lookalike = await middleware(new NextRequest("https://bitbudget.test/faq-private/settings"), {} as never)
    expect(lookalike?.headers.get("location")).toBe("https://bitbudget.test/welcome")
  })
})
