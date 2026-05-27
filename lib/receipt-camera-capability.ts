/** Mobile / tablet browsers where `<input capture>` opens the device camera directly. */
export function prefersNativeCaptureInput(): boolean {
  if (typeof globalThis.matchMedia !== "function") return false
  return globalThis.matchMedia("(pointer: coarse) and (hover: none)").matches
}

/** Browser exposes a live camera via MediaDevices (desktop webcams, most modern browsers). */
export function supportsLiveCamera(): boolean {
  if (typeof navigator === "undefined") return false
  return typeof navigator.mediaDevices?.getUserMedia === "function"
}

export type ReceiptCameraMode = "capture-input" | "live" | "upload-only"

/**
 * How “Take Photo” should work on this device:
 * - capture-input: hidden file input with `capture` (phones)
 * - live: in-app getUserMedia preview (desktop/laptop webcam)
 * - upload-only: no camera path; file picker only
 */
export function receiptCameraMode(): ReceiptCameraMode {
  if (prefersNativeCaptureInput()) return "capture-input"
  if (supportsLiveCamera()) return "live"
  return "upload-only"
}

export function canTakeReceiptPhoto(): boolean {
  return receiptCameraMode() !== "upload-only"
}
