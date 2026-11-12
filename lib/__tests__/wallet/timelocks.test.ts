import { describe, expect, it } from "vitest"
import { absoluteLocktime, relativeSequence, decodeRelativeSequence, checkCltv, checkCsv, isAbsoluteLocktimeMature } from "@/lib/wallet/timelocks"

describe("absolute locktimes and CLTV constraints", () => {
  it("separates heights from consensus timestamps", () => {
    expect(absoluteLocktime({ unit: "blocks", value: 499999999 })).toBe(499999999)
    expect(absoluteLocktime({ unit: "seconds", value: 500000000 })).toBe(500000000)
    expect(() => absoluteLocktime({ unit: "blocks", value: 500000000 })).toThrow()
    expect(() => absoluteLocktime({ unit: "seconds", value: 499999999 })).toThrow()
  })
  it.each([-1, 0.5, NaN, Infinity, 0x100000000, Number.MAX_SAFE_INTEGER + 1])("rejects non-uint32 locktimes %s", value => {
    expect(() => absoluteLocktime({ unit: "blocks", value })).toThrow()
    expect(() => checkCltv(10, value, 0xfffffffe)).toThrow()
  })
  it("requires matching units, a sufficient nLockTime and non-final sequence", () => {
    expect(checkCltv(100, 100, 0xfffffffe)).toBe(true)
    expect(checkCltv(100, 99, 0xfffffffe)).toBe(false)
    expect(checkCltv(100, 500000001, 0xfffffffe)).toBe(false)
    expect(checkCltv(100, 100, 0xffffffff)).toBe(false)
  })
  it("evaluates strict finality against supplied candidate height or previous MTP only", () => {
    expect(isAbsoluteLocktimeMature(100, { candidateHeight: 100, previousMedianTimePast: 1700000000 })).toBe(false)
    expect(isAbsoluteLocktimeMature(100, { candidateHeight: 101, previousMedianTimePast: 1700000000 })).toBe(true)
    expect(isAbsoluteLocktimeMature(1700000000, { candidateHeight: 101, previousMedianTimePast: 1700000000 })).toBe(false)
  })
})

describe("relative locktimes and CSV constraints", () => {
  it("encodes block units or exact 512-second units without rounding", () => {
    expect(relativeSequence({ unit: "blocks", value: 65535 })).toBe(65535)
    expect(relativeSequence({ unit: "seconds", value: 1024 })).toBe(0x400002)
    expect(decodeRelativeSequence(0x400002)).toEqual({ unit: "seconds", value: 1024 })
    expect(decodeRelativeSequence(2)).toEqual({ unit: "blocks", value: 2 })
  })
  it.each([1, 511, 513, -512, 512.5, 65536 * 512])("rejects invalid second units %s", value => {
    expect(() => relativeSequence({ unit: "seconds", value })).toThrow()
  })
  it.each([0x80000000, 0x10000, 0x200000, 0x100000000, -1, 0.1])("rejects disabled or reserved sequence flags %s", value => {
    expect(() => decodeRelativeSequence(value)).toThrow()
  })
  it("requires version 2+, matching type, no disable flag and enough sequence units", () => {
    expect(checkCsv(2, 2, 2)).toBe(true)
    expect(checkCsv(2, 1, 2)).toBe(false)
    expect(checkCsv(2, 2, 1)).toBe(false)
    expect(checkCsv(2, 2, 0x400002)).toBe(false)
    expect(() => checkCsv(2, 2, 0x80000002)).toThrow()
    expect(() => checkCsv(2, 2.5, 2)).toThrow()
  })
})
