import { describe, expect, it } from "vitest"
import { generateKeyPairFromSeed, encryptFieldAsymmetric } from "@/lib/crypto"
import { decryptParsedTransactionsForPreview } from "@/lib/import-preview-decrypt"
import type { ParsedTransaction } from "@/lib/csv"

describe("decryptParsedTransactionsForPreview", () => {
  it("decrypts payee when secret key is available", () => {
    const { secretKey, publicKey } = generateKeyPairFromSeed(new Uint8Array(32).fill(7))
    const rows: ParsedTransaction[] = [
      {
        date: "2026-03-01",
        payee: encryptFieldAsymmetric("Coffee Shop", publicKey),
        amount: 5,
        type: "expense",
        envelopeName: "Uncategorized",
        notes: null,
      },
    ]
    const out = decryptParsedTransactionsForPreview(rows, secretKey)
    expect(out[0]!.payee).toBe("Coffee Shop")
  })

  it("masks ciphertext when no secret key", () => {
    const { publicKey } = generateKeyPairFromSeed(new Uint8Array(32).fill(9))
    const rows: ParsedTransaction[] = [
      {
        date: "2026-03-01",
        payee: encryptFieldAsymmetric("Secret", publicKey),
        amount: 5,
        type: "expense",
        envelopeName: "Uncategorized",
        notes: null,
      },
    ]
    const out = decryptParsedTransactionsForPreview(rows, null)
    expect(out[0]!.payee).not.toBe("Secret")
    expect(out[0]!.payee).toBe("(encrypted)")
  })
})
