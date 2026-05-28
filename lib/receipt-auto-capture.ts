/** Width/height of the off-screen analysis canvas (downsampled for performance). */
export const ANALYSIS_W = 160
export const ANALYSIS_H = 120

/** Milliseconds between analysis frames (~6.7 fps). */
export const ANALYSIS_INTERVAL_MS = 150

/** How long the "ready" state must be held before auto-capture fires (ms). */
export const HOLD_DURATION_MS = 1200

// ─── Thresholds ─────────────────────────────────────────────────────────────

/** Laplacian variance; receipts on a flat surface typically score 100–800. */
const SHARPNESS_THRESHOLD = 100

/** Fraction of pixels classified as edges. Too low = blank wall; too high = noise. */
const EDGE_MIN = 0.05
const EDGE_MAX = 0.55

/** Per-pixel mean-absolute-difference stability (0=moving, 1=still). */
const STABILITY_THRESHOLD = 0.87

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FrameScore {
  /** Laplacian variance — sharpness indicator; higher = crisper. */
  laplacianVariance: number
  /** Fraction of pixels with a significant gradient (0–1). */
  edgeDensity: number
  /** Pixel-level stability vs previous frame (0–1). */
  stability: number
  /** True when sharpness, content, and stability all pass their thresholds. */
  ready: boolean
}

// ─── Core analysis ───────────────────────────────────────────────────────────

/**
 * Analyzes one video frame on the provided off-screen canvas.
 *
 * @param video      The live <video> element (must have non-zero dimensions).
 * @param canvas     A persistent off-screen canvas (ANALYSIS_W × ANALYSIS_H).
 * @param prevGray   Grayscale data from the previous call; null on first call.
 * @returns          The computed score and the grayscale buffer for next call.
 */
export function analyzeVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  prevGray: Uint8Array | null,
): { score: FrameScore; gray: Uint8Array } {
  const fallback = prevGray ?? new Uint8Array(ANALYSIS_W * ANALYSIS_H)
  const notReady: FrameScore = {
    laplacianVariance: 0,
    edgeDensity: 0,
    stability: 0,
    ready: false,
  }

  if (video.videoWidth === 0 || video.readyState < 2) {
    return { score: notReady, gray: fallback }
  }

  let ctx: CanvasRenderingContext2D | null
  try {
    ctx = canvas.getContext("2d", { willReadFrequently: true })
  } catch {
    return { score: notReady, gray: fallback }
  }
  if (!ctx) return { score: notReady, gray: fallback }

  try {
    ctx.drawImage(video, 0, 0, ANALYSIS_W, ANALYSIS_H)
  } catch {
    return { score: notReady, gray: fallback }
  }

  let imageData: ImageData
  try {
    imageData = ctx.getImageData(0, 0, ANALYSIS_W, ANALYSIS_H)
  } catch {
    // Some browsers/environments block getImageData for certain streams.
    return { score: notReady, gray: fallback }
  }

  const { data } = imageData
  const W = ANALYSIS_W
  const H = ANALYSIS_H
  const N = W * H

  // ── Grayscale conversion (ITU-R BT.601 coefficients, integer math) ──────────
  const gray = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    const j = i << 2
    gray[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8
  }

  // ── Laplacian variance (sharpness) ───────────────────────────────────────────
  // 4-connected Laplacian kernel: [0,1,0 / 1,-4,1 / 0,1,0]
  // High variance → sharp edges → well-focused image.
  let lapSum = 0
  const lapCount = (W - 2) * (H - 2)
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const lap =
        gray[(y - 1) * W + x] +
        gray[(y + 1) * W + x] +
        gray[y * W + (x - 1)] +
        gray[y * W + (x + 1)] -
        4 * gray[y * W + x]
      lapSum += lap * lap
    }
  }
  const laplacianVariance = lapCount > 0 ? lapSum / lapCount : 0

  // ── Sobel edge density ────────────────────────────────────────────────────────
  // Counts pixels where the Sobel gradient magnitude exceeds a threshold.
  // 5–55% edge pixels indicates a document with legible content in the frame.
  let edgeCount = 0
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const gx =
        -gray[(y - 1) * W + (x - 1)] +
        gray[(y - 1) * W + (x + 1)] +
        -2 * gray[y * W + (x - 1)] +
        2 * gray[y * W + (x + 1)] +
        -gray[(y + 1) * W + (x - 1)] +
        gray[(y + 1) * W + (x + 1)]
      const gy =
        gray[(y - 1) * W + (x - 1)] +
        2 * gray[(y - 1) * W + x] +
        gray[(y - 1) * W + (x + 1)] +
        -gray[(y + 1) * W + (x - 1)] +
        -2 * gray[(y + 1) * W + x] +
        -gray[(y + 1) * W + (x + 1)]
      // Squared magnitude threshold: 40² = 1600
      if (gx * gx + gy * gy > 1600) edgeCount++
    }
  }
  const edgeDensity = lapCount > 0 ? edgeCount / lapCount : 0

  // ── Frame stability (motion detection) ───────────────────────────────────────
  // MAD of per-pixel grayscale diff vs previous frame.
  // Values of 0 = perfectly still; 40+ = significant motion.
  let diffSum = 0
  if (prevGray !== null) {
    for (let i = 0; i < N; i++) {
      diffSum += Math.abs(gray[i] - prevGray[i])
    }
  }
  const stability =
    prevGray === null ? 0 : Math.max(0, 1 - diffSum / (N * 40))

  const ready =
    laplacianVariance >= SHARPNESS_THRESHOLD &&
    edgeDensity >= EDGE_MIN &&
    edgeDensity <= EDGE_MAX &&
    stability >= STABILITY_THRESHOLD

  return {
    score: { laplacianVariance, edgeDensity, stability, ready },
    gray,
  }
}

// ─── UI helpers ──────────────────────────────────────────────────────────────

/** Returns a short hint string for the current detection state. */
export function getAutoCaptureHint(score: FrameScore | null): string {
  if (!score) return "Point camera at a receipt"

  const hasContent =
    score.edgeDensity >= EDGE_MIN && score.edgeDensity <= EDGE_MAX

  if (!hasContent) return "Point camera at a receipt"
  if (score.laplacianVariance < SHARPNESS_THRESHOLD) return "Move closer or hold steady"
  if (score.stability < STABILITY_THRESHOLD) return "Hold still…"
  return "Hold still…"
}
