"use client"

import {
  encryptFieldAsymmetric,
  generateKeyPairFromSeed,
  hexToUint8,
} from "@/lib/crypto"
import { syncUserPublicKey } from "@/lib/sync-user-public-key"
import { getPendingNsec } from "@/lib/nostr-local-signer"

export type ImportEncryptFn = (plaintext: string) => Promise<string>

function encryptFnFromHexKey(hex: string): ImportEncryptFn {
  const { publicKey } = generateKeyPairFromSeed(hexToUint8(hex))
  return (plaintext: string) => Promise.resolve(encryptFieldAsymmetric(plaintext, publicKey))
}

type EncApiPayload = {
  userId: string
  encryptedPrivacyKey: string | null
  privacyKeySalt: string | null
  isNostr: boolean
  nostrPubkey: string | null
}

/**
 * Resolves the encrypt function used before POST /api/import.
 *
 * - Uses sessionStorage when it matches the current user (same as historical behavior).
 * - If missing, for Nostr extension accounts re-fetches encryption metadata and runs
 *   NIP-04 decrypt (same as AppProvider initEncryption). This fixes onboarding import
 *   when sessionStorage was cleared or the key was never written, as long as the
 *   server-stored ciphertext is valid for the current pubkey.
 */
export async function resolveEncryptFnForImport(): Promise<ImportEncryptFn | null> {
  if (typeof window === "undefined") return null

  const res = await fetch("/api/user/encryption")
  if (res.status === 401 || res.status === 403 || !res.ok) return null

  const data = (await res.json()) as EncApiPayload
  const hex = sessionStorage.getItem("bitbudget-privacy-key")
  const cachedUser = sessionStorage.getItem("bitbudget-privacy-user")

  if (hex && cachedUser === data.userId) {
    try {
      return encryptFnFromHexKey(hex)
    } catch {
      sessionStorage.removeItem("bitbudget-privacy-key")
      sessionStorage.removeItem("bitbudget-privacy-user")
    }
  } else if (cachedUser && cachedUser !== data.userId) {
    sessionStorage.removeItem("bitbudget-privacy-key")
    sessionStorage.removeItem("bitbudget-privacy-user")
  }

  if (!data.encryptedPrivacyKey) return null

  const isNsecFallback = data.isNostr && data.privacyKeySalt != null
  if (data.isNostr && data.nostrPubkey && !isNsecFallback) {
    const nip04 = (window as unknown as {
      nostr?: { nip04?: { decrypt: (pubkey: string, ciphertext: string) => Promise<string> } }
    }).nostr?.nip04

    if (nip04) {
      try {
        const hexKey = await nip04.decrypt(data.nostrPubkey, data.encryptedPrivacyKey)
        const pk = hexToUint8(hexKey)
        generateKeyPairFromSeed(pk)
        sessionStorage.setItem("bitbudget-privacy-key", hexKey)
        sessionStorage.setItem("bitbudget-privacy-user", data.userId)
        void syncUserPublicKey(pk)
        return encryptFnFromHexKey(hexKey)
      } catch {
        /* corrupt ciphertext, wrong pubkey, or user denied NIP-04 */
      }
    }

    const pendingNsec = getPendingNsec()
    if (pendingNsec) {
      try {
        const { decrypt: nip04Decrypt } = await import("nostr-tools/nip04")
        const hexKey = nip04Decrypt(pendingNsec, data.nostrPubkey, data.encryptedPrivacyKey)
        const pk = hexToUint8(hexKey)
        generateKeyPairFromSeed(pk)
        sessionStorage.setItem("bitbudget-privacy-key", hexKey)
        sessionStorage.setItem("bitbudget-privacy-user", data.userId)
        void syncUserPublicKey(pk)
        return encryptFnFromHexKey(hexKey)
      } catch {
        /* wrong key or corrupt ciphertext */
      }
    }
  }

  return null
}
