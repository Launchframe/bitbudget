import { runInNewContext } from "node:vm"
import { afterEach, describe, expect, it, vi } from "vitest"
import { credentialJson, extractPrf, walletPasskey } from "@/lib/wallet/browser-passkey"
import { openCreationDraft, sealCreationDraft } from "@/lib/wallet/creation-draft"
import * as http from "@/lib/wallet/client-http"

function credential(registration: boolean, output = new Uint8Array(32).fill(9).buffer) {
  const id = new Uint8Array([1, 2, 3]).buffer
  return {
    id: "AQID", rawId: id, type: "public-key",
    getClientExtensionResults: () => ({ prf: { enabled: true, results: { first: output } } }),
    response: registration ? { clientDataJSON: id, attestationObject: id } : { clientDataJSON: id, authenticatorData: id, signature: id, userHandle: null },
  } as unknown as PublicKeyCredential
}

function browserCredentials(create = vi.fn(), get = vi.fn()) {
  vi.stubGlobal("window", { isSecureContext: true })
  vi.stubGlobal("PublicKeyCredential", class {})
  vi.stubGlobal("navigator", { credentials: { create, get } })
  return { create, get }
}

const optionsEnvelope = {
  challengeId: "11111111-1111-4111-8111-111111111111",
  options: { challenge: "AQID", user: { id: "AQID", name: "wallet", displayName: "Wallet" } },
}
const grant = { verified: true, grantId: "22222222-2222-4222-8222-222222222222" }

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe("browser passkey privacy boundary", () => {
  it.each([true, false])("never serializes the PRF output in a credential response (registration=%s)", registration => {
    const data = credentialJson(credential(registration), registration)
    expect(data.clientExtensionResults).toEqual({})
    expect(JSON.stringify(data)).not.toContain("prf")
    expect(data.id).toBe("AQID")
  })

  it("copies the PRF output into caller custody and wipes the extension buffer", () => {
    const raw = new Uint8Array(32).fill(7)
    const copy = extractPrf(credential(true, raw.buffer))
    expect(copy).toEqual(new Uint8Array(32).fill(7))
    expect(raw.every(value => value === 0)).toBe(true)
    copy?.fill(0)
  })

  it("accepts genuine PRF and credential buffers from another JavaScript realm", () => {
    const foreign = runInNewContext("new Uint8Array(32).fill(7).buffer") as ArrayBuffer
    expect(foreign instanceof ArrayBuffer).toBe(false)
    const key = extractPrf(credential(true, foreign))
    expect(key).toEqual(new Uint8Array(32).fill(7))
    expect(new Uint8Array(foreign).every(value => value === 0)).toBe(true)
    key?.fill(0)
    const registration = credential(true)
    Object.assign(registration.response, { attestationObject: runInNewContext("new Uint8Array([1,2,3]).buffer") })
    expect(credentialJson(registration, true).response.attestationObject).toBe("AQID")
    const assertion = credential(false)
    Object.assign(assertion.response, { signature: runInNewContext("new Uint8Array([1,2,3]).buffer"), authenticatorData: runInNewContext("new Uint8Array([1,2,3]).buffer") })
    expect(credentialJson(assertion, false).response).toMatchObject({ signature: "AQID" })
  })

  it("refuses objects that merely imitate ArrayBuffer", () => {
    const spoof = { byteLength: 32, [Symbol.toStringTag]: "ArrayBuffer", slice: () => new ArrayBuffer(32) }
    expect(() => extractPrf(credential(true, spoof as unknown as ArrayBuffer))).toThrow("passkey-encryption-unavailable")
  })

  it("refuses unsupported and malformed PRF results", () => {
    expect(() => extractPrf(credential(true, new ArrayBuffer(31)))).toThrow("passkey-encryption-unavailable")
    const unsupported = { getClientExtensionResults: () => ({ prf: { enabled: false } }) } as unknown as PublicKeyCredential
    expect(() => extractPrf(unsupported)).toThrow("passkey-encryption-unavailable")
  })

  it("does not make a request when browser passkeys are unavailable", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    await expect(walletPasskey("regtest", false)).rejects.toThrow("passkey-encryption-unavailable")
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe("passkey provider diagnostics", () => {
  it("does not register a provider that omits PRF support", async () => {
    const request = vi.spyOn(http, "walletRequest").mockResolvedValue(optionsEnvelope)
    const unsupported = credential(true)
    unsupported.getClientExtensionResults = () => ({})
    const browser = browserCredentials(vi.fn().mockResolvedValue(unsupported))
    await expect(walletPasskey("regtest", false)).rejects.toMatchObject({ code: "passkey-encryption-unavailable", reason: "not-supported" })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toBe("/api/wallets/credentials/registration/options")
    expect(browser.get).not.toHaveBeenCalled()
  })

  it("evaluates PRF with authentication when creation reports support without output", async () => {
    const request = vi.spyOn(http, "walletRequest")
      .mockResolvedValueOnce(optionsEnvelope).mockResolvedValueOnce(grant)
      .mockResolvedValueOnce(optionsEnvelope).mockResolvedValueOnce(grant)
    const registration = credential(true)
    registration.getClientExtensionResults = () => ({ prf: { enabled: true } }) as AuthenticationExtensionsClientOutputs
    const browser = browserCredentials(vi.fn().mockResolvedValue(registration), vi.fn().mockResolvedValue(credential(false)))
    const result = await walletPasskey("regtest", false)
    expect(result).toMatchObject({ credentialId: "AQID", grantId: grant.grantId })
    expect(result.prfOutput).toEqual(new Uint8Array(32).fill(9))
    result.prfOutput.fill(0)
    expect(browser.get).toHaveBeenCalledTimes(1)
    expect(request.mock.calls.map(call => call[0])).toEqual([
      "/api/wallets/credentials/registration/options", "/api/wallets/credentials/registration/verify",
      "/api/wallets/credentials/authentication/options", "/api/wallets/credentials/authentication/verify",
    ])
    expect(JSON.stringify(request.mock.calls)).not.toContain("prf")
  })

  it("distinguishes missing authentication output without verifying a grant", async () => {
    const request = vi.spyOn(http, "walletRequest").mockResolvedValue(optionsEnvelope)
    const assertion = credential(false)
    assertion.getClientExtensionResults = () => ({})
    browserCredentials(vi.fn(), vi.fn().mockResolvedValue(assertion))
    await expect(walletPasskey("regtest", true)).rejects.toMatchObject({ code: "passkey-encryption-unavailable", reason: "missing-output" })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it("does not mislabel an unexpected ceremony error as unsupported encryption", async () => {
    vi.spyOn(http, "walletRequest").mockResolvedValue(optionsEnvelope)
    browserCredentials(vi.fn().mockRejectedValue(new TypeError("simulated ceremony failure")))
    await expect(walletPasskey("regtest", false)).rejects.toMatchObject({ code: "passkey-ceremony-failed" })
  })
})

describe("encrypted pending creation", () => {
  const binding = { accountId: "owner", walletId: "wallet", credentialId: "credential", network: "regtest" }
  it("round-trips only with the same PRF, account, wallet and credential", async () => {
    const prf = crypto.getRandomValues(new Uint8Array(32))
    const data = { aToBHex: "ab".repeat(64), transcriptHash: "cd".repeat(32) }
    const sealed = await sealCreationDraft(data, prf, binding)
    expect(JSON.stringify(sealed)).not.toContain(data.aToBHex)
    expect(await openCreationDraft(sealed, prf, binding)).toEqual(data)
    for (const changed of [{ ...binding, accountId: "other" }, { ...binding, walletId: "other" }, { ...binding, credentialId: "other" }, { ...binding, network: "signet" }]) {
      await expect(openCreationDraft(sealed, prf, changed)).rejects.toThrow()
    }
    await expect(openCreationDraft(sealed, crypto.getRandomValues(new Uint8Array(32)), binding)).rejects.toThrow()
    prf.fill(0)
  })
})
