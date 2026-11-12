import type { ParsedTransaction } from "@/lib/csv"
import { decryptFieldAsymmetric, looksLikeAsymmetricCiphertext } from "@/lib/crypto"
import { ENCRYPTED_DISPLAY } from "@/lib/encrypted-display"

/** Decrypt statement/email batch rows for importer preview (client-only). */
export function decryptParsedTransactionsForPreview(
  rows: ParsedTransaction[],
  secretKey: Uint8Array | null,
): ParsedTransaction[] {
  if (!secretKey) {
    return rows.map((t) => ({
      ...t,
      payee: looksLikeAsymmetricCiphertext(t.payee) ? ENCRYPTED_DISPLAY : t.payee,
      notes:
        t.notes != null && looksLikeAsymmetricCiphertext(t.notes) ? ENCRYPTED_DISPLAY : t.notes,
    }))
  }
  return rows.map((t) => {
    let payee = t.payee
    let notes = t.notes
    try {
      payee = decryptFieldAsymmetric(t.payee, secretKey)
    } catch {
      payee = looksLikeAsymmetricCiphertext(t.payee) ? ENCRYPTED_DISPLAY : t.payee
    }
    if (t.notes) {
      try {
        notes = decryptFieldAsymmetric(t.notes, secretKey)
      } catch {
        notes = looksLikeAsymmetricCiphertext(t.notes) ? ENCRYPTED_DISPLAY : t.notes
      }
    }
    return { ...t, payee, notes }
  })
}
