import { JSDOM } from "jsdom"
import { act, type ComponentProps } from "react"
import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import WalletSetup from "@/components/wallet/wallet-setup"
import { WalletClientError } from "@/lib/wallet/client-http"

const mocks = vi.hoisted(() => ({ passkey: vi.fn(), run: vi.fn(), dispose: vi.fn(), getPrivacyKey: () => new Uint8Array(32).fill(1) }))
vi.mock("@/lib/app-context", () => ({ useApp: () => ({ getPrivacyKey: mocks.getPrivacyKey }) }))
vi.mock("@/components/ui/input", () => ({ Input: ({ onChange, ...props }: ComponentProps<"input">) => <input {...props} onInput={onChange as ComponentProps<"input">["onInput"]} /> }))
vi.mock("@/lib/wallet/browser-passkey", () => ({ walletPasskey: mocks.passkey, PasskeyEncryptionError: class extends Error {} }))
vi.mock("@/lib/crypto", () => ({ encryptField: async () => "encrypted-name", decryptField: async () => "My wallet" }))
vi.mock("@/lib/wallet/creation-worker-client", () => ({ CreationWorkerClient: class { run = mocks.run; dispose = mocks.dispose } }))

let dom: JSDOM
const password = "synthetic recovery password"
const walletId = "11111111-1111-4111-8111-111111111111"

beforeAll(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:3001" })
  vi.stubGlobal("window", dom.window)
  vi.stubGlobal("self", dom.window)
  vi.stubGlobal("document", dom.window.document)
  vi.stubGlobal("navigator", dom.window.navigator)
  vi.stubGlobal("sessionStorage", dom.window.sessionStorage)
  vi.stubGlobal("Event", dom.window.Event)
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
})
beforeEach(() => { vi.resetAllMocks(); sessionStorage.clear(); window.localStorage.clear() })
afterEach(cleanup)
afterAll(() => { dom.window.close(); vi.unstubAllGlobals() })

async function protectionForm() {
  const props = { userId: "fixture", network: "regtest" as const, hasCredential: false, onClose: vi.fn(), onChanged: vi.fn() }
  const view = render(<WalletSetup {...props} />)
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "Continue to protection" })) })
  fireEvent.input(view.getByLabelText("Recovery password (at least 12 characters)"), { target: { value: password } })
  fireEvent.input(view.getByLabelText("Confirm recovery password"), { target: { value: password } })
  expect(view.getByRole("button", { name: "Create wallet with passkey" })).toBeEnabled()
  return { view, props }
}

async function submit(view: ReturnType<typeof render>) {
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "Create wallet with passkey" })) })
}

describe("wallet setup password retry", () => {
  it("masks both fields by default and reveals each independently without submitting", async () => {
    const { view } = await protectionForm()
    const recovery = view.getByLabelText("Recovery password (at least 12 characters)")
    const confirmation = view.getByLabelText("Confirm recovery password")
    const reveal = view.getByRole("button", { name: "Show recovery password" })
    expect(recovery).toHaveAttribute("type", "password")
    expect(confirmation).toHaveAttribute("type", "password")
    expect(reveal).toHaveAttribute("type", "button")
    expect(reveal).toHaveAttribute("aria-controls", recovery.id)
    fireEvent.click(reveal)
    expect(recovery).toHaveAttribute("type", "text")
    expect(confirmation).toHaveAttribute("type", "password")
    fireEvent.click(view.getByRole("button", { name: "Hide recovery password" }))
    fireEvent.click(view.getByRole("button", { name: "Show recovery password confirmation" }))
    expect(recovery).toHaveAttribute("type", "password")
    expect(confirmation).toHaveAttribute("type", "text")
    fireEvent.click(view.getByRole("button", { name: "Hide recovery password confirmation" }))
    expect(confirmation).toHaveAttribute("type", "password")
    expect(recovery).toHaveValue(password)
    expect(confirmation).toHaveValue(password)
    expect(mocks.passkey).not.toHaveBeenCalled()
    expect(mocks.run).not.toHaveBeenCalled()
    expect(sessionStorage.length).toBe(0)
    expect(window.localStorage.length).toBe(0)
  })

  it.each(["passkey-encryption-unavailable", "setup-cancelled", "passkey-ceremony-failed"])("restores both fields after %s without saving them", async code => {
    mocks.passkey.mockRejectedValue(new WalletClientError(code))
    const { view, props } = await protectionForm()
    fireEvent.click(view.getByRole("button", { name: "Show recovery password" }))
    fireEvent.click(view.getByRole("button", { name: "Show recovery password confirmation" }))
    await submit(view)
    expect(mocks.passkey).toHaveBeenCalledOnce()
    expect(view.getByRole("alert")).toHaveAttribute("data-wallet-error-code", code)
    expect(view.getByLabelText("Recovery password (at least 12 characters)")).toHaveValue(password)
    expect(view.getByLabelText("Confirm recovery password")).toHaveValue(password)
    expect(view.getByLabelText("Recovery password (at least 12 characters)")).toHaveAttribute("type", "password")
    expect(view.getByLabelText("Confirm recovery password")).toHaveAttribute("type", "password")
    view.rerender(<WalletSetup {...props} hasCredential />)
    await submit(view)
    expect(mocks.passkey).toHaveBeenCalledTimes(2)
    expect(mocks.run).not.toHaveBeenCalled()
    expect(sessionStorage.length).toBe(0)
    expect(window.localStorage.length).toBe(0)
    view.unmount()
    const reopened = render(<WalletSetup {...props} />)
    fireEvent.click(reopened.getByRole("button", { name: "Continue to protection" }))
    expect(reopened.getByLabelText("Recovery password (at least 12 characters)")).toHaveValue("")
    expect(reopened.getByLabelText("Confirm recovery password")).toHaveValue("")
  })

  it("does not restore the creation password after a partial save", async () => {
    mocks.passkey.mockImplementation(async () => ({ credentialId: "credential", grantId: "grant", prfOutput: new Uint8Array(32) }))
    mocks.run.mockImplementationOnce((_request, progress) => {
      progress({ stage: "saved", walletId })
      throw new WalletClientError("wallet-creation-failed")
    }).mockResolvedValueOnce({ walletId, recoveryFile: "synthetic-encrypted-file" })
    const { view } = await protectionForm()
    await submit(view)
    expect(view.queryByLabelText("Confirm recovery password")).toBeNull()
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Finish saving wallet" })) })
    expect(view.getByLabelText("Recovery password", { exact: true })).toHaveValue("")
    expect(mocks.run.mock.calls[1][0].type).toBe("resume")
    expect(mocks.run.mock.calls[1][0].input).not.toHaveProperty("password")
  })

  it("ignores a late passkey failure after setup is unmounted", async () => {
    let reject: (error: Error) => void = () => {}
    mocks.passkey.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
    const { view, props } = await protectionForm()
    await submit(view)
    expect(view.getByRole("heading", { name: "Creating your wallet" })).toBeVisible()
    view.unmount()
    expect(mocks.passkey.mock.calls[0][2].aborted).toBe(true)
    await act(async () => { reject(new WalletClientError("setup-cancelled")) })
    expect(props.onChanged).not.toHaveBeenCalled()
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it("keeps the password cleared after successful creation for independent recovery verification", async () => {
    mocks.passkey.mockResolvedValue({ credentialId: "credential", grantId: "grant", prfOutput: new Uint8Array(32) })
    mocks.run.mockResolvedValue({ walletId, recoveryFile: "synthetic-encrypted-file" })
    const { view } = await protectionForm()
    await submit(view)
    expect(mocks.run.mock.calls[0][0].input.password).toBe(password)
    expect(view.getByRole("heading", { name: "Save and verify your recovery file" })).toBeVisible()
    expect(view.getByLabelText("Recovery password", { exact: true })).toHaveValue("")
    expect(view.queryByLabelText("Confirm recovery password")).toBeNull()
    const recovery = view.getByLabelText("Recovery password", { exact: true })
    expect(recovery).toHaveAttribute("type", "password")
    fireEvent.input(recovery, { target: { value: password } })
    fireEvent.click(view.getByRole("button", { name: "Show recovery password" }))
    expect(recovery).toHaveAttribute("type", "text")
    expect(recovery).toHaveValue(password)
    fireEvent.click(view.getByRole("button", { name: "Hide recovery password" }))
    expect(recovery).toHaveAttribute("type", "password")
    expect(mocks.run).toHaveBeenCalledOnce()
  })
})
