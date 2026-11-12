import { JSDOM } from "jsdom"
import { act } from "react"
import { cleanup, render } from "@testing-library/react"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { WalletFeatureHost } from "@/components/wallet-feature-host"
import { setWalletFeaturePreference } from "@/lib/wallet-feature-preference"

const { context, mount } = vi.hoisted(() => ({
  context: {
    currentUserId: "alice" as string | null,
    currentPage: "dashboard",
    state: { opportunityCostEnabled: true },
    loading: false,
    encryption: { ready: true, needsPinUnlock: false },
  },
  mount: vi.fn(),
}))

vi.mock("@/lib/app-context", () => ({ useApp: () => context }))
vi.mock("next/dynamic", () => ({
  default: () => function LazyWallet({ userId, visible }: { userId: string; visible: boolean }) {
    mount(userId, visible)
    return <div data-testid="wallet-runtime" data-user={userId} data-visible={String(visible)} />
  },
}))

let dom: JSDOM
beforeAll(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://bitbudget.test" })
  vi.stubGlobal("window", dom.window)
  vi.stubGlobal("document", dom.window.document)
  vi.stubGlobal("navigator", dom.window.navigator)
  vi.stubGlobal("Event", dom.window.Event)
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
})
beforeEach(() => {
  window.localStorage.clear()
  Object.assign(context, { currentUserId: "alice", currentPage: "dashboard", loading: false })
  context.state.opportunityCostEnabled = true
  Object.assign(context.encryption, { ready: true, needsPinUnlock: false })
  mount.mockClear()
})
afterEach(cleanup)
afterAll(() => {
  dom.window.close()
  vi.unstubAllGlobals()
})

function host() {
  return <WalletFeatureHost><p>Ordinary budget</p></WalletFeatureHost>
}

describe("wallet lazy activation boundary", () => {
  it("does not mount the wallet for a never-enabled Bitcoin account", () => {
    const view = render(host())
    expect(view.getByText("Ordinary budget")).toBeInTheDocument()
    expect(mount).not.toHaveBeenCalled()
  })

  it("does not mount for vanilla even with cached activation and a deep link", () => {
    setWalletFeaturePreference("alice", true)
    context.currentPage = "wallet"
    context.state.opportunityCostEnabled = false
    const view = render(host())
    expect(mount).not.toHaveBeenCalled()
    expect(view.queryByTestId("wallet-runtime")).toBeNull()
    expect(view.container.textContent).not.toContain("Bitcoin")
  })

  it.each(["account", "privacy", "identity"])("waits for %s prerequisites", (gate) => {
    context.currentPage = "wallet"
    if (gate === "account") context.loading = true
    if (gate === "privacy") context.encryption.needsPinUnlock = true
    if (gate === "identity") context.currentUserId = null
    render(host())
    expect(mount).not.toHaveBeenCalled()
  })

  it("mounts a requested wallet without rendering the underlying dashboard", () => {
    context.currentPage = "wallet"
    const view = render(host())
    expect(view.getByTestId("wallet-runtime")).toHaveAttribute("data-visible", "true")
    expect(view.queryByText("Ordinary budget")).toBeNull()
  })

  it("resumes only the current account and retains its runtime across pages", () => {
    setWalletFeaturePreference("alice", true)
    const view = render(host())
    const runtime = view.getByTestId("wallet-runtime")
    expect(runtime).toHaveAttribute("data-visible", "false")
    context.currentPage = "wallet"
    view.rerender(host())
    expect(view.getByTestId("wallet-runtime")).toBe(runtime)
    context.currentPage = "settings"
    view.rerender(host())
    expect(view.getByTestId("wallet-runtime")).toBe(runtime)
    context.currentUserId = "bob"
    view.rerender(host())
    expect(view.queryByTestId("wallet-runtime")).toBeNull()
  })

  it("unmounts background wallet when the saved preference is disabled", () => {
    setWalletFeaturePreference("alice", true)
    const view = render(host())
    expect(view.getByTestId("wallet-runtime")).toBeInTheDocument()
    act(() => { setWalletFeaturePreference("alice", false) })
    expect(view.queryByTestId("wallet-runtime")).toBeNull()
    expect(view.getByText("Ordinary budget")).toBeInTheDocument()
  })
})
