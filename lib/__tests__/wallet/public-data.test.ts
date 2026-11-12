import { describe, expect, it } from "vitest"
import { bytesToHex, hexToBytes, hexToUtf8, sha256Hex, utf8ToHex } from "@/lib/wallet/public-data-tools"
import { buildOpReturn, padApprovedPublicData, isRdtsMarkerScript } from "@/lib/wallet/op-return"
import { createWalletIdentity, toSatoshis, outpointKey } from "@/lib/wallet/types"

describe("wallet identity and integer amounts", () => {
  it("keeps both lineages under one network-specific identity", () => {
    expect(createWalletIdentity("wallet-1", "signet")).toEqual({ id: "wallet-1", network: "signet", lineages: ["sha256d", "blake2b"] })
    expect(toSatoshis("9007199254740993")).toBe(BigInt("9007199254740993"))
    expect(toSatoshis(12)).toBe(BigInt(12))
  })
  it("normalizes outpoints without allowing trailing line endings", () => {
    expect(outpointKey({ txid: "AB".repeat(32), vout: 0 })).toBe(`${"ab".repeat(32)}:0`)
    expect(() => outpointKey({ txid: "ab".repeat(32) + "\n", vout: 0 })).toThrow()
  })
  it.each([-1, 0.1, Number.MAX_SAFE_INTEGER + 1, "1.0", " 1", "1e2", "-1", "1\n"])("rejects invalid units %s", value => {
    expect(() => toSatoshis(value)).toThrow()
  })
})

describe("strict local public data conversions", () => {
  it("round trips Unicode and normalized hex without fetching", async () => {
    expect(hexToUtf8(utf8ToHex("public café 漢字"))).toBe("public café 漢字")
    expect(bytesToHex(hexToBytes("AABB00"))).toBe("aabb00")
    expect(await sha256Hex(utf8ToHex("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  })
  it.each(["a", "0x00", "00 11", "zz", "\n00", "00\n", "00\r", "00\u2028"])("rejects malformed hex %s", value => {
    expect(() => hexToBytes(value)).toThrow()
  })
  it("rejects malformed UTF8 and lone UTF16 surrogates", () => {
    expect(() => hexToUtf8("c080")).toThrow()
    expect(() => hexToUtf8("ff")).toThrow()
    expect(() => utf8ToHex("\ud800")).toThrow()
    expect(hexToUtf8("efbbbf61")).toBe("\ufeffa")
  })
})

describe("canonical OP_RETURN", () => {
  it("uses minimal numeric pushes and handles the PUSHDATA4 boundary", () => {
    expect(buildOpReturn("01").scriptHex).toBe("6a51")
    expect(buildOpReturn("10").scriptHex).toBe("6a60")
    expect(buildOpReturn("81").scriptHex).toBe("6a4f")
    const large = buildOpReturn("ab".repeat(65536))
    expect(large.scriptHex.startsWith("6a4e00000100")).toBe(true)
    expect(large.scriptBytes).toBe(65542)
    expect(isRdtsMarkerScript(large.scriptHex)).toBe(true)
  })
  it.each([[0, "6a00", 2], [75, "6a4b", 77], [76, "6a4c4c", 79], [80, "6a4c50", 83], [81, "6a4c51", 84], [255, "6a4cff", 258], [256, "6a4d0001", 260]])("serializes %i payload bytes", (size, prefix, scriptSize) => {
    const result = buildOpReturn("ab".repeat(size))
    expect(result.scriptHex.startsWith(prefix)).toBe(true)
    expect(result.scriptBytes).toBe(scriptSize)
    expect(result.payloadBytes).toBe(size)
  })
  it("does not mislabel an 80-byte payload as the 84-byte marker", () => {
    expect(isRdtsMarkerScript(buildOpReturn("ab".repeat(80)).scriptHex)).toBe(false)
    expect(isRdtsMarkerScript(buildOpReturn("ab".repeat(81)).scriptHex)).toBe(true)
    expect(isRdtsMarkerScript("6a4d5100" + "ab".repeat(81))).toBe(false)
    expect(isRdtsMarkerScript("6a4c51" + "ab".repeat(80))).toBe(false)
  })
  it("requires explicit public-data and padding approval and preserves metadata", () => {
    const source = { payloadHex: "cafe", metadata: { label: "user label", contentType: "application/octet-stream" } }
    expect(() => padApprovedPublicData(source, { publicDataApproved: false, paddingApproved: true })).toThrow()
    expect(() => padApprovedPublicData(source, { publicDataApproved: true, paddingApproved: false })).toThrow()
    const padded = padApprovedPublicData(source, { publicDataApproved: true, paddingApproved: true })
    expect(padded.payloadHex).toBe("cafe" + "00".repeat(79))
    expect(padded.metadata).toEqual(source.metadata)
    expect(source.payloadHex).toBe("cafe")
    expect(padApprovedPublicData({ payloadHex: "ab".repeat(90) }, { publicDataApproved: true, paddingApproved: true }).payloadHex).toBe("ab".repeat(90))
  })
})
