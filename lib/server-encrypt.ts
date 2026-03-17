import { encryptFieldAsymmetric, hexToPublicKey } from "./crypto"

export function encryptFieldForUser(
  plaintext: string | null | undefined,
  publicKeyHex: string | null | undefined
): string | null {
  if (!plaintext || !publicKeyHex) return null
  const publicKey = hexToPublicKey(publicKeyHex)
  return encryptFieldAsymmetric(plaintext, publicKey)
}
