import { JSDOM } from "jsdom"
import { act } from "react"
import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import ElectrumConnectionTest from "@/components/wallet/electrum-connection-test"

const mocks = vi.hoisted(() => ({ construct: vi.fn(), dispose: vi.fn(), probe: vi.fn() }))
vi.mock("@/lib/wallet/chain/electrum-client", () => ({
  ElectrumClient: class { constructor(options: unknown) { mocks.construct(options) } dispose() { mocks.dispose() } },
  ElectrumError: class extends Error {},
}))
vi.mock("@/lib/wallet/chain/electrum-diagnostics", () => ({ testElectrumConnection: mocks.probe }))
let dom: JSDOM
const result = { probe: { observedServerVersion: "fixture", observedHeight: 100 }, readOnly: true, consensusVerified: false, mainnetGenesisMatches: true }

beforeAll(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:3001" })
  vi.stubGlobal("window", dom.window)
  vi.stubGlobal("document", dom.window.document)
  vi.stubGlobal("navigator", dom.window.navigator)
  vi.stubGlobal("Event", dom.window.Event)
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
})
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("NODE_ENV", "development"); mocks.probe.mockResolvedValue(result) })
afterEach(() => { cleanup(); vi.unstubAllEnvs() })
afterAll(() => { dom.window.close(); vi.unstubAllGlobals() })

describe("Electrum bridge connection test UI", () => {
  it("does not connect until the user acts and labels success as read-only, not consensus verification", async () => {
    const view = render(<ElectrumConnectionTest />)
    expect(mocks.construct).not.toHaveBeenCalled()
    expect(view.getByLabelText("Electrum bridge URL")).toHaveValue("ws://127.0.0.1:50004/electrum")
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Test read-only connection" })) })
    expect(mocks.construct).toHaveBeenCalledWith({ url: "ws://127.0.0.1:50004/electrum", allowLoopbackDevelopment: true, timeoutMs: 60000 })
    expect(view.getByRole("status")).toHaveTextContent("Connection test passed · read-only")
    expect(view.getByRole("status")).toHaveTextContent("does not verify chain work")
    expect(mocks.dispose).toHaveBeenCalledOnce()
    expect(window.localStorage.length).toBe(0)
  })

  it("cancels without allowing a late result to overwrite the UI", async () => {
    let resolve: (value: unknown) => void = () => {}
    mocks.probe.mockImplementation(() => new Promise(done => { resolve = done }))
    const view = render(<ElectrumConnectionTest />)
    fireEvent.click(view.getByRole("button", { name: "Test read-only connection" }))
    fireEvent.click(view.getByRole("button", { name: "Cancel test" }))
    await act(async () => { resolve(result) })
    expect(view.queryByRole("status")).toBeNull()
    expect(mocks.dispose).toHaveBeenCalled()
  })

  it("does not default to an insecure transport in production", () => {
    vi.stubEnv("NODE_ENV", "production")
    const view = render(<ElectrumConnectionTest />)
    expect(view.getByLabelText("Electrum bridge URL")).toHaveValue("")
    expect(view.getByRole("button", { name: "Test read-only connection" })).toBeDisabled()
    expect(mocks.construct).not.toHaveBeenCalled()
  })
})
