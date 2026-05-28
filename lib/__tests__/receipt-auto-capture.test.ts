import { describe, expect, it } from "vitest"
import {
  ANALYSIS_H,
  ANALYSIS_W,
  analyzeVideoFrame,
  getAutoCaptureHint,
  type FrameScore,
} from "@/lib/receipt-auto-capture"

function makeImageData(
  pixel: (x: number, y: number) => [number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(ANALYSIS_W * ANALYSIS_H * 4)
  for (let y = 0; y < ANALYSIS_H; y++) {
    for (let x = 0; x < ANALYSIS_W; x++) {
      const i = (y * ANALYSIS_W + x) * 4
      const [r, g, b] = pixel(x, y)
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return { data } as ImageData
}

function fakeCanvas(imageData: ImageData): HTMLCanvasElement {
  return {
    getContext: () => ({
      drawImage: () => {},
      getImageData: () => imageData,
    }),
  } as unknown as HTMLCanvasElement
}

function fakeVideo(overrides: Partial<HTMLVideoElement> = {}): HTMLVideoElement {
  return {
    videoWidth: ANALYSIS_W,
    videoHeight: ANALYSIS_H,
    readyState: 2,
    ...overrides,
  } as HTMLVideoElement
}

describe("analyzeVideoFrame", () => {
  it("returns not-ready and preserves previous gray data when video is unavailable", () => {
    const prevGray = new Uint8Array(ANALYSIS_W * ANALYSIS_H).fill(123)
    const result = analyzeVideoFrame(
      fakeVideo({ videoWidth: 0, readyState: 0 }),
      fakeCanvas(makeImageData(() => [255, 255, 255])),
      prevGray,
    )

    expect(result.score).toEqual({
      laplacianVariance: 0,
      edgeDensity: 0,
      stability: 0,
      ready: false,
    })
    expect(result.gray).toBe(prevGray)
  })

  it("does not mark blank frames as ready", () => {
    const result = analyzeVideoFrame(
      fakeVideo(),
      fakeCanvas(makeImageData(() => [255, 255, 255])),
      null,
    )

    expect(result.score.laplacianVariance).toBe(0)
    expect(result.score.edgeDensity).toBe(0)
    expect(result.score.stability).toBe(0)
    expect(result.score.ready).toBe(false)
  })

  it("marks a sharp stable receipt-like frame as ready after the first frame", () => {
    const receiptLike = makeImageData((x, y) => {
      const onTextLine = y > 16 && y < ANALYSIS_H - 16 && y % 10 < 4
      const onGlyphStroke = x > 20 && x < ANALYSIS_W - 20 && x % 14 < 3
      return onTextLine && onGlyphStroke ? [0, 0, 0] : [245, 245, 245]
    })
    const canvas = fakeCanvas(receiptLike)
    const first = analyzeVideoFrame(fakeVideo(), canvas, null)
    const second = analyzeVideoFrame(fakeVideo(), canvas, first.gray)

    expect(first.score.ready).toBe(false)
    expect(second.score.laplacianVariance).toBeGreaterThanOrEqual(100)
    expect(second.score.edgeDensity).toBeGreaterThanOrEqual(0.05)
    expect(second.score.edgeDensity).toBeLessThanOrEqual(0.55)
    expect(second.score.stability).toBe(1)
    expect(second.score.ready).toBe(true)
  })
})

describe("getAutoCaptureHint", () => {
  const baseScore: FrameScore = {
    laplacianVariance: 120,
    edgeDensity: 0.1,
    stability: 0.9,
    ready: true,
  }

  it("uses receipt-specific guidance based on the failing score", () => {
    expect(getAutoCaptureHint(null)).toBe("Point camera at a receipt")
    expect(getAutoCaptureHint({ ...baseScore, edgeDensity: 0.01, ready: false })).toBe(
      "Point camera at a receipt",
    )
    expect(getAutoCaptureHint({ ...baseScore, laplacianVariance: 50, ready: false })).toBe(
      "Move closer or hold steady",
    )
    expect(getAutoCaptureHint({ ...baseScore, stability: 0.2, ready: false })).toBe("Hold still…")
    expect(getAutoCaptureHint(baseScore)).toBe("Hold still…")
  })
})
