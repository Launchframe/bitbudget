import { afterEach, describe, expect, it, vi } from "vitest"
import { credentialJson, extractPrf, walletPasskey } from "@/lib/wallet/browser-passkey"
import { openCreationDraft, sealCreationDraft } from "@/lib/wallet/creation-draft"

function credential(registration: boolean, output = new Uint8Array(32).fill(9).buffer) {
  const id = new Uint8Array([1, 2, 3]).buffer
  return {
    id: "AQID", rawId: id, type: "public-key",
    getClientExtensionResults: () => ({ prf: { enabled: true, results: { first: output } } }),
    response: registration ? { clientDataJSON: id, attestationObject: id } : { clientDataJSON: id, authenticatorData: id, signature: id, userHandle: null },
  } as unknown as PublicKeyCredential
}

afterEach(() => vi.unstubAllGlobals())

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
