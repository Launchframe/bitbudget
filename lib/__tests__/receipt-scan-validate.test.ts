import { describe, it, expect } from "vitest"
import { resolveReceiptFileKind, normalizeScanExtraction } from "../receipt-scan-validate"

describe("resolveReceiptFileKind", () => {
  it("detects PDF from magic bytes", () => {
    const buf = Buffer.concat([
      Buffer.from("%PDF-1.4\n", "ascii"),
      Buffer.alloc(4, 0),
    ])
    expect(resolveReceiptFileKind(buf)).toBe("application/pdf")
  })
  it("detects JPEG from SOI marker", () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
    expect(resolveReceiptFileKind(buf)).toBe("image/jpeg")
  })
  it("detects PNG from signature", () => {
    const buf = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, // .PNG
      0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d,
    ])
    expect(resolveReceiptFileKind(buf)).toBe("image/png")
  })
  it("detects WEBP from RIFF/WEBP headers", () => {
    const riffHeader = Buffer.from("RIFF", "ascii")
    const webpHeader = Buffer.from("WEBP", "ascii")
    const size = Buffer.alloc(4, 0) // size placeholder
    const buf = Buffer.concat([riffHeader, size, webpHeader, Buffer.alloc(4, 0)])
    expect(resolveReceiptFileKind(buf)).toBe("image/webp")
  })
  it("detects HEIC-like images via ftyp and brand", () => {
    const leading = Buffer.alloc(4, 0)
    const ftyp = Buffer.from("ftyp", "ascii")
    const brand = Buffer.from("heic", "ascii")
    const trailing = Buffer.alloc(4, 0)
    const buf = Buffer.concat([leading, ftyp, brand, trailing])
    expect(resolveReceiptFileKind(buf)).toBe("image/heic")
  })
  it("returns null for unsupported or too-short buffers", () => {
    expect(resolveReceiptFileKind(Buffer.alloc(4, 0))).toBeNull()
    const random = Buffer.from("NOTAREALFORMAT", "ascii")
    expect(resolveReceiptFileKind(random)).toBeNull()
  })
})
describe("normalizeScanExtraction", () => {
  it("normalizes payee spacing and trims to 500 chars", () => {
    const longName = "A".repeat(600)
    const result = normalizeScanExtraction({
      payee: "  Foo   Bar  ",
      amount: 10,
      date: "2024-01-02",
    })
    const truncated = normalizeScanExtraction({
      payee: longName,
      amount: 0,
      date: "2024-01-01",
    })
    expect(result.payee).toBe("Foo Bar")
    expect(truncated.payee.length).toBe(500)
  })
  it("accepts finite non-negative numeric amounts", () => {
    const result = normalizeScanExtraction({
      payee: "Store",
      amount: 12.5,
      date: "2024-01-02",
    })
    expect(result.amount).toBe("12.5")
  })
  it("parses currency strings with $ and commas", () => {
    const result = normalizeScanExtraction({
      payee: "Store",
      amount: " $1,234.50 ",
      date: "2024-01-02",
    })
    expect(result.amount).toBe("1234.50")
  })
  it("rejects invalid amount formats", () => {
    const tooManyDecimals = normalizeScanExtraction({
      payee: "Store",
      amount: "12.345",
      date: "2024-01-02",
    })
    const nonNumeric = normalizeScanExtraction({
      payee: "Store",
      amount: "abc",
      date: "2024-01-02",
    })
    expect(tooManyDecimals.amount).toBe("")
    expect(nonNumeric.amount).toBe("")
  })
  it("accepts valid ISO dates and rejects others", () => {
    const valid = normalizeScanExtraction({
      payee: "Store",
      amount: 1,
      date: "2024-03-15",
    })
    const invalidFormat = normalizeScanExtraction({
      payee: "Store",
      amount: 1,
      date: "15/03/2024",
    })
    const missingPadding = normalizeScanExtraction({
      payee: "Store",
      amount: 1,
      date: "2024-3-5",
    })
    expect(valid.date).toBe("2024-03-15")
    expect(invalidFormat.date).toBe("")
    expect(missingPadding.date).toBe("")
  })

  describe("extractionConfidence", () => {
    it("uses model-reported confidence when present and clamps to [0,1]", () => {
      expect(normalizeScanExtraction({ payee: "A", amount: "5.00", date: "2024-01-01", confidence: 0.6 }).extractionConfidence).toBe(0.6)
      expect(normalizeScanExtraction({ payee: "A", amount: "5.00", date: "2024-01-01", confidence: 1.5 }).extractionConfidence).toBe(1)
      expect(normalizeScanExtraction({ payee: "A", amount: "5.00", date: "2024-01-01", confidence: -0.1 }).extractionConfidence).toBe(0)
    })
    it("falls back to field-completeness heuristic when confidence is absent", () => {
      // All fields present → full score (0.3 + 0.5 + 0.2 = 1.0)
      expect(normalizeScanExtraction({ payee: "Store", amount: "10", date: "2024-01-01" }).extractionConfidence).toBe(1.0)
      // Only payee → 0.3
      expect(normalizeScanExtraction({ payee: "Store", amount: "", date: "" }).extractionConfidence).toBeCloseTo(0.3)
      // Nothing → 0
      expect(normalizeScanExtraction({ payee: "", amount: "", date: "" }).extractionConfidence).toBe(0)
    })
    it("ignores non-numeric confidence values and uses heuristic", () => {
      const result = normalizeScanExtraction({ payee: "A", amount: "5.00", date: "2024-01-01", confidence: "high" })
      expect(result.extractionConfidence).toBe(1.0)
    })
  })
})