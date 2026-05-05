import { describe, expect, it } from "vitest"

describe("pdfjs-server-globals", () => {
  it("sets GlobalWorkerOptions.workerSrc for pdfjs-dist worker file", async () => {
    const { initReceiptPdfParseEnvironment } = await import("@/lib/pdfjs-server-globals")
    await initReceiptPdfParseEnvironment()

    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toMatch(/^file:.+\/pdf\.worker\.mjs$/)
  })
})
