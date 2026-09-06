import { IDBFactory } from "fake-indexeddb"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { wrapDeviceShare, type ShareCustodyContext } from "@/lib/wallet/client-custody"
import { createRecoveryPackage } from "@/lib/wallet/recovery-package"
import { openWalletCustodyStore, type WalletCustodyStore } from "@/lib/wallet/wallet-idb"
import { sealCreationDraft } from "@/lib/wallet/creation-draft"
import { encryptField } from "@/lib/crypto"

let factory: IDBFactory
const stores: WalletCustodyStore[] = []
beforeEach(() => { factory = new IDBFactory() })
afterEach(() => { for (const store of stores.splice(0)) store.close() })

async function open(accountId = "alice") {
  const store = await openWalletCustodyStore(accountId, factory)
  stores.push(store)
  return store
}

async function fixture() {
  const context = {
    accountId: "alice", walletId: "wallet-1", network: "regtest" as const,
    shareFormat: "storage-test-v1", groupPublicKeyHex: "11".repeat(32), publicPackageHex: "abcd",
    policy: { threshold: 2 as const, participants: 3 as const }, derivationContext: "storage-only-fixture",
  }
  const a: ShareCustodyContext = { ...context, participantId: "1", role: "A" }
  const c: ShareCustodyContext = { ...context, participantId: "3", role: "C" }
  const secret = crypto.getRandomValues(new Uint8Array(32))
  const prf = crypto.getRandomValues(new Uint8Array(32))
  try {
    return {
      context,
      envelopes: {
        deviceShare: await wrapDeviceShare({ share: secret, context: a, credentialId: "credential-a", prfOutput: prf }),
        recoveryShare: await createRecoveryPackage({ share: secret, context: c, password: "synthetic-test-password" }),
        optionalDeviceExport: null,
      },
    }
  } finally { secret.fill(0); prf.fill(0) }
}

describe("account-scoped custody storage", () => {
  it("stores one identity for both lineages without operational wrapping keys", async () => {
    const store = await open()
    const input = await fixture()
    const created = await store.createWallet(input)
    expect(created.identity).toEqual({ id: "wallet-1", network: "regtest", lineages: ["sha256d", "blake2b"] })
    expect(await store.getWallet("wallet-1")).toEqual(created)
    expect(JSON.stringify(created)).not.toContain("synthetic-test-password")
    expect(created.envelopes.deviceShare).not.toHaveProperty("wrappingKey")
    expect(created.envelopes.deviceShare).not.toHaveProperty("prfOutput")
    expect(created.envelopes.deviceShare).not.toHaveProperty("share")
    expect(created).not.toHaveProperty("indexer")
  })

  it("does not disclose another account's wallet or accept an account mismatch", async () => {
    const alice = await open()
    const bob = await open("bob")
    const input = await fixture()
    await alice.createWallet(input)
    expect(await bob.getWallet("wallet-1")).toBeNull()
    await expect(bob.createWallet(input)).rejects.toThrow("Wallet account mismatch")
  })

  it("does not reset existing custody on duplicate creation", async () => {
    const store = await open()
    const input = await fixture()
    const original = await store.createWallet(input)
    await expect(store.createWallet(input)).rejects.toThrow("Wallet already exists")
    expect(await store.getWallet("wallet-1")).toEqual(original)
  })

  it("atomically reserves indices across open connections and never rewinds on envelope updates", async () => {
    const first = await open()
    const second = await open()
    const input = await fixture()
    await first.createWallet(input)
    const reservations = await Promise.all([
      first.reserveAddressIndices("wallet-1", "receive"),
      second.reserveAddressIndices("wallet-1", "receive"),
    ])
    expect(reservations.map(result => result.startIndex).sort()).toEqual([0, 1])
    const current = await first.getWallet("wallet-1")
    expect(current?.nextReceiveIndex).toBe(2)
    expect(current?.nextChangeIndex).toBe(0)
    const updated = await first.replaceEnvelopes("wallet-1", current!.revision, input.envelopes)
    expect(updated.nextReceiveIndex).toBe(2)
    await expect(second.replaceEnvelopes("wallet-1", current!.revision, input.envelopes)).rejects.toThrow("Wallet revision conflict")
    expect((await second.reserveAddressIndices("wallet-1", "receive")).startIndex).toBe(2)
    expect((await second.reserveAddressIndices("wallet-1", "change")).startIndex).toBe(0)
  })

  it("persists only an encrypted name and retry body, and cannot mark recovery while DKG is pending", async () => {
    const store = await open()
    const input = await fixture()
    const key = crypto.getRandomValues(new Uint8Array(32))
    const encryptedName = await encryptField("Private wallet label", key)
    const pendingCreation = await sealCreationDraft({ aToBHex: "secret-contribution" }, key, { accountId: "alice", walletId: "wallet-1", credentialId: "credential-a", network: "regtest" })
    const created = await store.createWallet({ ...input, encryptedName, pendingCreation })
    expect(JSON.stringify(created)).not.toContain("Private wallet label")
    expect(JSON.stringify(created)).not.toContain("secret-contribution")
    await expect(store.recordRecoveryVerification("wallet-1", created.revision, new Date().toISOString())).rejects.toThrow("Wallet revision conflict")
    const completed = await store.completeCreation("wallet-1", created.revision)
    expect(completed.pendingCreation).toBeNull()
    expect(completed.context).toEqual(created.context)
    expect(completed.envelopes).toEqual(created.envelopes)
    const verified = await store.recordRecoveryVerification("wallet-1", completed.revision, "2026-09-06T00:00:00.000Z")
    expect(verified.recoveryVerifiedAt).toBe("2026-09-06T00:00:00.000Z")
    key.fill(0)
  })

  it("rejects plaintext or asymmetric transaction-encryption labels rather than saving the wrong format", async () => {
    const store = await open()
    const input = await fixture()
    for (const encryptedName of ["Private wallet", "asym:v1:abc", `${"00".repeat(12)}:${"0".repeat(33)}`]) {
      await expect(store.createWallet({ ...input, encryptedName })).rejects.toThrow("Invalid encrypted wallet name")
    }
    expect(await store.getWallet("wallet-1")).toBeNull()
  })

  it("rejects mismatched envelope context and invalid reservation sizes", async () => {
    const store = await open()
    const input = await fixture()
    await expect(store.createWallet({ ...input, envelopes: { ...input.envelopes, recoveryShare: { ...input.envelopes.recoveryShare, context: { ...input.envelopes.recoveryShare.context, walletId: "other" } } } })).rejects.toThrow("Wallet envelope context mismatch")
    await store.createWallet(input)
    for (const count of [0, -1, 1.5, 10_001]) {
      await expect(store.reserveAddressIndices("wallet-1", "receive", count)).rejects.toThrow("Invalid reservation count")
    }
  })
})
