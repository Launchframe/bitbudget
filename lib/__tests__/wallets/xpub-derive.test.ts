// @vitest-environment node
import { describe, expect, it } from "vitest"
import { base58check } from "@scure/base"
import { sha256 } from "@noble/hashes/sha2.js"
import {
  deriveAddress,
  deriveAddressForKind,
  deriveAddressRange,
  extendedKeyVersionHex,
  parseExtendedKey,
  pubkeyToP2PKH,
  pubkeyToP2SHP2WPKH,
  pubkeyToP2WPKH,
} from "@/lib/wallets/xpub-derive"

const b58 = base58check(sha256)

/** Re-encode an xpub's payload under the given 4-byte version prefix. */
function reencodeWithVersion(xpub: string, version: Uint8Array): string {
  const raw = b58.decode(xpub)
  const out = new Uint8Array(78)
  out.set(version, 0)
  out.set(raw.slice(4), 4)
  return b58.encode(out)
}

const XPUB_VER = new Uint8Array([0x04, 0x88, 0xb2, 0x1e])
const YPUB_VER = new Uint8Array([0x04, 0x9d, 0x7c, 0xb2])
const TPUB_VER = new Uint8Array([0x04, 0x35, 0x87, 0xcf])

// BIP84 official test vector — account zpub for the abandon-mnemonic at m/84'/0'/0'.
// Reference: https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki
const BIP84_ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs"
const BIP84_RECEIVE_0 = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"
const BIP84_RECEIVE_1 = "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g"
const BIP84_CHANGE_0 = "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el"

describe("extendedKeyVersionHex", () => {
  it("returns the 4-byte version as lowercase hex", () => {
    expect(extendedKeyVersionHex(BIP84_ZPUB)).toBe("04b24746")
  })
  it("returns null for invalid input", () => {
    expect(extendedKeyVersionHex("not-a-key")).toBeNull()
    expect(extendedKeyVersionHex("")).toBeNull()
  })
})

describe("parseExtendedKey: kind detection", () => {
  it("detects bip84 from zpub version bytes", () => {
    expect(parseExtendedKey(BIP84_ZPUB).kind).toBe("bip84")
  })

  it("detects bip44 from xpub and bip49 from ypub", () => {
    // Reuse the public key material from the BIP84 vector under different version
    // prefixes so we test our parser's branching without inventing addresses.
    const asXpub = reencodeWithVersion(BIP84_ZPUB, XPUB_VER)
    const asYpub = reencodeWithVersion(BIP84_ZPUB, YPUB_VER)
    expect(parseExtendedKey(asXpub).kind).toBe("bip44")
    expect(parseExtendedKey(asYpub).kind).toBe("bip49")
  })

  it("rejects testnet tpub and unknown prefixes", () => {
    const tpub = reencodeWithVersion(BIP84_ZPUB, TPUB_VER)
    expect(() => parseExtendedKey(tpub)).toThrow(/Unrecognized/)
  })

  it("rejects empty input", () => {
    expect(() => parseExtendedKey("")).toThrow(/empty/)
    expect(() => parseExtendedKey("   ")).toThrow(/empty/)
  })

  it("rejects checksum failures and wrong length", () => {
    expect(() => parseExtendedKey("zpub-bogus")).toThrow(/checksum/)
    // Truncated valid base58check payload (will pass base58 decode of garbage but fail length check).
    expect(() => parseExtendedKey("zzzzzzzz")).toThrow()
  })
})

describe("deriveAddress: BIP84 official test vector", () => {
  it("matches the published 0/0, 0/1, and 1/0 addresses", () => {
    const parsed = parseExtendedKey(BIP84_ZPUB)
    expect(deriveAddress(parsed, 0, 0)).toBe(BIP84_RECEIVE_0)
    expect(deriveAddress(parsed, 0, 1)).toBe(BIP84_RECEIVE_1)
    expect(deriveAddress(parsed, 1, 0)).toBe(BIP84_CHANGE_0)
  })

  it("derives in deterministic order via deriveAddressRange", () => {
    const parsed = parseExtendedKey(BIP84_ZPUB)
    const range = deriveAddressRange(parsed, 0, 0, 2)
    expect(range).toEqual([BIP84_RECEIVE_0, BIP84_RECEIVE_1])
  })

  it("rejects an inverted range", () => {
    const parsed = parseExtendedKey(BIP84_ZPUB)
    expect(() => deriveAddressRange(parsed, 0, 5, 3)).toThrow()
  })
})

describe("deriveAddress: address-format invariants", () => {
  it("BIP44 addresses start with 1 (mainnet P2PKH)", () => {
    const xpub = reencodeWithVersion(BIP84_ZPUB, XPUB_VER)
    const a = deriveAddress(parseExtendedKey(xpub), 0, 0)
    expect(a.startsWith("1")).toBe(true)
    expect(a.length).toBeGreaterThanOrEqual(26)
    expect(a.length).toBeLessThanOrEqual(35)
  })

  it("BIP49 addresses start with 3 (mainnet P2SH-P2WPKH)", () => {
    const ypub = reencodeWithVersion(BIP84_ZPUB, YPUB_VER)
    const a = deriveAddress(parseExtendedKey(ypub), 0, 0)
    expect(a.startsWith("3")).toBe(true)
  })

  it("BIP84 addresses start with bc1q (mainnet native segwit v0)", () => {
    const a = deriveAddress(parseExtendedKey(BIP84_ZPUB), 0, 0)
    expect(a.startsWith("bc1q")).toBe(true)
  })
})

describe("deriveAddressForKind: low-level encoders", () => {
  // Compressed pubkey from a known seed: BIP84 test vector m/84'/0'/0'/0/0 child pubkey.
  // We let parseExtendedKey produce it so the test matches the same path as runtime.
  const parsed = parseExtendedKey(BIP84_ZPUB)
  const child = parsed.hdkey.deriveChild(0).deriveChild(0)
  const pubkey = child.publicKey!

  it("encodes the same pubkey three ways consistently", () => {
    expect(pubkeyToP2PKH(pubkey).startsWith("1")).toBe(true)
    expect(pubkeyToP2SHP2WPKH(pubkey).startsWith("3")).toBe(true)
    expect(pubkeyToP2WPKH(pubkey)).toBe(BIP84_RECEIVE_0)
  })

  it("deriveAddressForKind dispatches by kind", () => {
    expect(deriveAddressForKind(pubkey, "bip84")).toBe(pubkeyToP2WPKH(pubkey))
    expect(deriveAddressForKind(pubkey, "bip44")).toBe(pubkeyToP2PKH(pubkey))
    expect(deriveAddressForKind(pubkey, "bip49")).toBe(pubkeyToP2SHP2WPKH(pubkey))
  })
})
