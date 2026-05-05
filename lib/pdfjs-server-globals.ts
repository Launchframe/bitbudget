/**
 * pdf-parse pulls in pdfjs-dist, which expects browser geometry APIs at module load time.
 * Node / Vercel serverless do not define DOMMatrix, Path2D, or ImageData globally.
 *
 * Next/Turbopack must not bundle pdfjs-dist (see serverExternalPackages); otherwise pdf.js
 * resolves `./pdf.worker.mjs` relative to a chunk path where it does not exist. We set
 * `GlobalWorkerOptions.workerSrc` to an absolute file URL from `require.resolve`.
 *
 * Turbopack rejects fully dynamic `import(fileUrl)` ("expression is too dynamic"). Keep the
 * pdf.js entry import as a **static string** (`import("pdfjs-dist/legacy/build/pdf.mjs")`).
 * `pdfjs-dist` is a direct dependency so that specifier resolves from the app root under pnpm.
 *
 * Call `initReceiptPdfParseEnvironment()` before `import("pdf-parse")` / `PDFParse` in server routes.
 */
import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas"

const g = globalThis as unknown as Record<string, unknown>

if (typeof g.DOMMatrix === "undefined") {
  g.DOMMatrix = DOMMatrix
}
if (typeof g.Path2D === "undefined") {
  g.Path2D = Path2D
}
if (typeof g.ImageData === "undefined") {
  g.ImageData = ImageData
}

function requireViaPdfParsePackage(): NodeRequire {
  const requireFromRoot = createRequire(path.join(process.cwd(), "package.json"))
  const pdfParseMain = requireFromRoot.resolve("pdf-parse")
  return createRequire(pdfParseMain)
}

/** Absolute file URL to pdf.worker.mjs (same physical file pdf-parse uses when versions match). */
function pdfWorkerFileUrl(): string {
  const requireFromRoot = createRequire(path.join(process.cwd(), "package.json"))
  try {
    const resolved = requireFromRoot.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")
    return pathToFileURL(resolved).href
  } catch {
    const hostedRequire = requireViaPdfParsePackage()
    const resolved = hostedRequire.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")
    return pathToFileURL(resolved).href
  }
}

let pdfJsWorkerConfigured: Promise<void> | null = null

export async function initReceiptPdfParseEnvironment(): Promise<void> {
  if (!pdfJsWorkerConfigured) {
    pdfJsWorkerConfigured = (async () => {
      const workerHref = pdfWorkerFileUrl()
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
      pdfjs.GlobalWorkerOptions.workerSrc = workerHref
    })()
  }
  try {
    await pdfJsWorkerConfigured
  } catch (err) {
    pdfJsWorkerConfigured = null
    throw err
  }
}
