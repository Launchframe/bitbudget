/** User-facing copy for Premium-gated controls (not API error strings). */

export const PREMIUM_LOCKED_LABEL = "Premium"

export const PREMIUM_UI_COPY = {
  receiptScan: {
    hint: "Receipt scanning requires Premium or an active trial.",
    dialogHint:
      "Take a photo or upload a receipt to auto-fill a transaction. Available with Premium or an active trial.",
  },
  voiceEntry: {
    hint: "Voice entry requires Premium or an active trial.",
    sheetHint: "Dictate payee and amount hands-free. Available with Premium or an active trial.",
  },
  inputMode: {
    camera: "Scan receipts with your camera. Premium or trial required.",
    upload: "Upload receipt photos or PDFs. Premium or trial required.",
    voice: "Voice entry requires Premium or an active trial.",
  },
} as const
