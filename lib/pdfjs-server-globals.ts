/**
 * pdf-parse bundles pdfjs-dist, which expects browser geometry APIs at module load time.
 * Node / Vercel serverless do not define DOMMatrix, Path2D, or ImageData globally.
 * pdf-parse's own worker entry does the same assignment using @napi-rs/canvas.
 *
 * Import this module before `pdf-parse` in any server route that uses PDFParse.
 */
import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas"

// Cast through unknown so assignments are not checked against TS DOM lib globals.
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

export {}
