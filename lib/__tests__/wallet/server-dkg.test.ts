import { randomBytes } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { loadWalletMpc } from "@/lib/wallet/server/mpc"
import { beginCosignerDkg, finishCosignerDkg } from "@/lib/wallet/server/dkg"
import { unwrapCosignerShare } from "@/lib/wallet/server/encryption"

const binding = { userId: "test-account", walletId: "test-wallet", network: "regtest" }

beforeEach(() => {
  vi.stubEnv("WALLET_COSIGNER_ENCRYPTION_KEY", randomBytes(32).toString("base64"))
})
afterEach(() => vi.unstubAllEnvs())

describe("durable co-signer DKG with real WASM", () => {
  it("restores encrypted B state and agrees with A/C without assembling the wallet key", async () => {
    const core = await loadWalletMpc()
    const a = new core.WasmDkgRound1(1)
    const c = new core.WasmDkgRound1(3)
    const aBroadcast = a.broadcast()
    const cBroadcast = c.broadcast()
    const begin = await beginCosignerDkg(binding, aBroadcast, cBroadcast)
    expect(begin.encryptedState).not.toContain(Buffer.from("BitBudget-DKG"))
    const a2 = a.advance(2, begin.broadcast, 3, cBroadcast)
    const c2 = c.advance(1, aBroadcast, 2, begin.broadcast)
    expect(Buffer.from(a2.broadcast_digest()).toString("hex")).toBe(begin.transcriptHash)
    expect(Buffer.from(c2.broadcast_digest()).toString("hex")).toBe(begin.transcriptHash)
    const aToB = a2.take_message(2)
    const cToB = c2.take_message(2)
    const aToC = a2.take_message(3)
    const cToA = c2.take_message(1)
    const aShare = a2.finish(2, begin.toA, 3, cToA)
    const cShare = c2.finish(1, aToC, 2, begin.toC)
    const publicPackage = aShare.public_package()
    const finish = await finishCosignerDkg(binding, begin.encryptedState, begin.transcriptHash, aToB, cToB, publicPackage)
    expect(finish.publicPackage).toEqual(publicPackage)
    expect(finish.outputKey).toEqual(aShare.output_key())
    expect(cShare.output_key()).toEqual(finish.outputKey)
    const bBytes = unwrapCosignerShare(finish.encryptedShare, { ...binding, publicPackageHash: finish.publicPackageHash })
    const bShare = core.WasmWalletShare.import_secret_share(2, bBytes, publicPackage)
    bBytes.fill(0)
    const digest = randomBytes(32)
    const aNonce = aShare.commit_digest_low_level(digest, 2)
    const bNonce = bShare.commit_digest_low_level(digest, 1)
    const session = new core.WasmSigningSession(digest, 1, aNonce.commitment(), 2, bNonce.commitment())
    const signature = session.aggregate(publicPackage, 1, aNonce.sign(aShare, session), 2, bNonce.sign(bShare, session))
    expect(() => core.verify_signature(publicPackage, digest, signature)).not.toThrow()
    session.free()
    aShare.free()
    bShare.free()
    cShare.free()
    aToB.fill(0); cToB.fill(0); aToC.fill(0); cToA.fill(0); begin.toA.fill(0); begin.toC.fill(0)
  })

  it("rejects owner, wallet, transcript, and ciphertext substitution", async () => {
    const core = await loadWalletMpc()
    const a = new core.WasmDkgRound1(1)
    const c = new core.WasmDkgRound1(3)
    const begin = await beginCosignerDkg(binding, a.broadcast(), c.broadcast())
    for (const changed of [{ ...binding, userId: "other" }, { ...binding, walletId: "other" }, { ...binding, network: "signet" }]) {
      await expect(finishCosignerDkg(changed, begin.encryptedState, begin.transcriptHash, new Uint8Array(), new Uint8Array(), new Uint8Array())).rejects.toThrow()
    }
    await expect(finishCosignerDkg(binding, begin.encryptedState, "00".repeat(32), new Uint8Array(), new Uint8Array(), new Uint8Array())).rejects.toThrow()
    const corrupt = Buffer.from(begin.encryptedState)
    corrupt[30] ^= 1
    await expect(finishCosignerDkg(binding, corrupt, begin.transcriptHash, new Uint8Array(), new Uint8Array(), new Uint8Array())).rejects.toThrow()
    expect(() => unwrapCosignerShare(begin.encryptedState, { ...binding, publicPackageHash: begin.transcriptHash, purpose: "share" })).toThrow()
    a.free(); c.free(); begin.toA.fill(0); begin.toC.fill(0)
  })

  it("does not accept mainnet or malformed public contributions", async () => {
    await expect(beginCosignerDkg({ ...binding, network: "mainnet" }, new Uint8Array(), new Uint8Array())).rejects.toThrow()
    await expect(beginCosignerDkg(binding, new Uint8Array(1), new Uint8Array(1))).rejects.toThrow()
  })
})
