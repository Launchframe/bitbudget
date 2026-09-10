// @vitest-environment jsdom
import { webcrypto } from "node:crypto"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
  STORAGE_KEY_PREFIX,
  WALLETS_BLOB_VERSION,
  buildStoredWallet,
  clearWallets,
  hasStoredWallets,
  isAllowedExplorerBase,
  loadWallets,
  saveWallets,
  type StoredWallet,
} from "@/lib/wallets/xpub-store"
import { decryptField, encryptField, generatePrivacyKey } from "@/lib/crypto"

beforeAll(() => {
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto as unknown as Crypto
  }
})

beforeEach(() => {
  window.localStorage.clear()
})

const sampleWallet = (over: Partial<StoredWallet> = {}): StoredWallet => ({
  id: "wlt_x",
  nickname: "Cold Storage",
  xpub: "xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz",
  kind: "bip44",
  gapLimit: 20,
  defaultEnvelopeId: null,
  receiveMode: "savings",
  explorerBaseUrl: "https://mempool.space",
  addedAt: "2026-05-09T00:00:00.000Z",
  lastSyncAt: null,
  ...over,
})

describe("xpub-store: namespaced storage", () => {
  it("uses a per-user localStorage key", () => {
    expect(`${STORAGE_KEY_PREFIX}user-1`).not.toBe(`${STORAGE_KEY_PREFIX}user-2`)
  })

  it("returns [] when no blob exists", async () => {
    const key = generatePrivacyKey()
    expect(await loadWallets("user-1", key)).toEqual([])
    expect(hasStoredWallets("user-1")).toBe(false)
  })
})

describe("xpub-store: round-trip", () => {
  it("saves and loads wallets through encryption", async () => {
    const key = generatePrivacyKey()
    const wallets = [sampleWallet({ id: "a" }), sampleWallet({ id: "b", nickname: "Hot" })]
    await saveWallets("user-1", key, wallets)
    expect(hasStoredWallets("user-1")).toBe(true)
    const loaded = await loadWallets("user-1", key)
    expect(loaded.map((w) => w.id)).toEqual(["a", "b"])
    expect(loaded[0]!.nickname).toBe("Cold Storage")
    expect(loaded[1]!.nickname).toBe("Hot")
  })

  it("stores ciphertext in localStorage (not the raw xpub)", async () => {
    const key = generatePrivacyKey()
    const w = sampleWallet({ id: "x" })
    await saveWallets("user-1", key, [w])
    const raw = window.localStorage.getItem(`${STORAGE_KEY_PREFIX}user-1`) ?? ""
    expect(raw).not.toContain(w.xpub)
    expect(raw).not.toContain(w.nickname)
    expect(raw).toMatch(/^[0-9a-f]{24}:[0-9a-f]+$/)
  })

  it("isolates wallets between users", async () => {
    const keyA = generatePrivacyKey()
    const keyB = generatePrivacyKey()
    await saveWallets("user-A", keyA, [sampleWallet({ id: "only-a" })])
    await saveWallets("user-B", keyB, [sampleWallet({ id: "only-b" })])
    const a = await loadWallets("user-A", keyA)
    const b = await loadWallets("user-B", keyB)
    expect(a.map((w) => w.id)).toEqual(["only-a"])
    expect(b.map((w) => w.id)).toEqual(["only-b"])
  })

  it("throws on a wrong privacy key (no silent overwrite)", async () => {
    const realKey = generatePrivacyKey()
    const wrongKey = generatePrivacyKey()
    await saveWallets("user-1", realKey, [sampleWallet({ id: "a" })])
    await expect(loadWallets("user-1", wrongKey)).rejects.toThrow()
  })

  it("clearWallets removes the per-user blob", async () => {
    const key = generatePrivacyKey()
    await saveWallets("user-1", key, [sampleWallet({ id: "a" })])
    clearWallets("user-1")
    expect(hasStoredWallets("user-1")).toBe(false)
  })

  it("strips trailing slashes from explorer URLs on save", async () => {
    const key = generatePrivacyKey()
    await saveWallets("user-1", key, [
      sampleWallet({ id: "a", explorerBaseUrl: "https://mempool.space///" }),
    ])
    const [w] = await loadWallets("user-1", key)
    expect(w!.explorerBaseUrl).toBe("https://mempool.space")
  })

  it("upgrades v1 blobs (no receiveMode) to Savings on read and rewrites as v2", async () => {
    const key = generatePrivacyKey()
    const { receiveMode: _dropped, ...v1Wallet } = sampleWallet({ id: "legacy" })
    void _dropped
    const v1Blob = JSON.stringify({ version: 1, wallets: [v1Wallet] })
    window.localStorage.setItem(`${STORAGE_KEY_PREFIX}user-1`, await encryptField(v1Blob, key))

    const [loaded] = await loadWallets("user-1", key)
    expect(loaded!.receiveMode).toBe("savings")
    expect(loaded!.defaultEnvelopeId).toBeNull()

    await saveWallets("user-1", key, [loaded!])
    const raw = window.localStorage.getItem(`${STORAGE_KEY_PREFIX}user-1`)!
    const rewritten = JSON.parse(await decryptField(raw, key)) as { version: number; wallets: StoredWallet[] }
    expect(rewritten.version).toBe(WALLETS_BLOB_VERSION)
    expect(rewritten.wallets[0]!.receiveMode).toBe("savings")
  })

  it("drops unknown receiveMode values back to the default", async () => {
    const key = generatePrivacyKey()
    const bad = { ...sampleWallet({ id: "bad" }), receiveMode: "moon" as unknown as StoredWallet["receiveMode"] }
    await saveWallets("user-1", key, [bad])
    const [w] = await loadWallets("user-1", key)
    expect(w!.receiveMode).toBe("savings")
  })
})

describe("buildStoredWallet", () => {
  it("fills defaults and trims input", () => {
    const w = buildStoredWallet(
      {
        nickname: "  Cold  ",
        xpub: "  xpub6...  ",
        kind: "bip84",
      },
      new Date("2026-05-09T12:00:00Z"),
    )
    expect(w.nickname).toBe("Cold")
    expect(w.xpub).toBe("xpub6...")
    expect(w.kind).toBe("bip84")
    expect(w.gapLimit).toBe(20)
    expect(w.defaultEnvelopeId).toBeNull()
    expect(w.receiveMode).toBe("savings")
    expect(w.explorerBaseUrl).toBe("https://mempool.space")
    expect(w.addedAt).toBe("2026-05-09T12:00:00.000Z")
    expect(w.lastSyncAt).toBeNull()
    expect(w.id).toMatch(/^wlt_/)
  })
})

describe("isAllowedExplorerBase", () => {
  it("accepts any https URL with a host", () => {
    expect(isAllowedExplorerBase("https://mempool.space").ok).toBe(true)
    expect(isAllowedExplorerBase("https://blockstream.info/api").ok).toBe(true)
    expect(isAllowedExplorerBase("https://mempool.example.com:8443").ok).toBe(true)
  })

  it("accepts http only for local-network and onion hosts", () => {
    expect(isAllowedExplorerBase("http://umbrel.local:3006").ok).toBe(true)
    expect(isAllowedExplorerBase("http://localhost:3006").ok).toBe(true)
    expect(isAllowedExplorerBase("http://127.0.0.1:3006").ok).toBe(true)
    expect(isAllowedExplorerBase("http://192.168.1.5").ok).toBe(true)
    expect(isAllowedExplorerBase("http://10.0.0.5").ok).toBe(true)
    expect(isAllowedExplorerBase("http://172.16.5.10").ok).toBe(true)
    expect(isAllowedExplorerBase("http://abc123.onion").ok).toBe(true)
  })

  it("rejects http for public hosts", () => {
    const r = isAllowedExplorerBase("http://mempool.space")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/local-network/)
  })

  it("rejects unsupported schemes and malformed URLs", () => {
    expect(isAllowedExplorerBase("ftp://x").ok).toBe(false)
    expect(isAllowedExplorerBase("not a url").ok).toBe(false)
    expect(isAllowedExplorerBase("https://").ok).toBe(false)
  })

  it("rejects 172 ranges outside RFC1918", () => {
    expect(isAllowedExplorerBase("http://172.15.0.1").ok).toBe(false)
    expect(isAllowedExplorerBase("http://172.32.0.1").ok).toBe(false)
  })
})
