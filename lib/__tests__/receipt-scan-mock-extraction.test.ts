import { describe, expect, it } from "vitest"
import { normalizeScanExtraction } from "@/lib/receipt-scan-validate"

describe("e2e mock scan response", () => {
  it("extracts payee and amount from receipt-scan.prefill mock shape", () => {
    const result = normalizeScanExtraction({
      type: "receipt",
      payee: "Receipt Scan Café ZZ99",
      amount: "42.50",
      date: "2026-04-01",
      extractionConfidence: 0.92,
      suggestedEnvelopeId: null,
      suggestedEnvelopeName: null,
      confidence: 0,
      envelopeMatchConfidence: null,
      model: "GPT-4o mini",
      processingMs: 1240,
      inputType: "photo",
      fileSizeBytes: 24601,
    })
    expect(result.payee).toBe("Receipt Scan Café ZZ99")
    expect(result.amount).toBe("42.50")
    expect(result.date).toBe("2026-04-01")
  })
})
