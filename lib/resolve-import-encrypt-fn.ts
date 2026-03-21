"use client"

import { getSession } from "next-auth/react"
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

function sessionGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function sessionSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    /* private mode / quota / blocked storage */
  }
}

function sessionRemove(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

/**
 * Resolves the encrypt function used before POST /api/import.
 *
 * - Fast path: valid cached key + `getSession()` user id match avoids `/api/user/encryption`.
 * - Otherwise fetches encryption metadata; for Nostr extension accounts may run
 *   NIP-04 decrypt (same as AppProvider initEncryption). This fixes onboarding import
 *   when sessionStorage was cleared or the key was never written, as long as the
 *   server-stored ciphertext is valid for the current pubkey.
 */
export async function resolveEncryptFnForImport(): Promise<ImportEncryptFn | null> {
  if (typeof window === "undefined") return null

  let hex = sessionGet("bitbudget-privacy-key")
  let cachedUser = sessionGet("bitbudget-privacy-user")

  if (hex && cachedUser) {
    const session = await getSession()
    const sid = session?.user?.id
    if (sid && sid === cachedUser) {
      try {
        return encryptFnFromHexKey(hex)
      } catch {
        sessionRemove("bitbudget-privacy-key")
        sessionRemove("bitbudget-privacy-user")
        hex = null
        cachedUser = null
      }
    } else if (sid && sid !== cachedUser) {
      sessionRemove("bitbudget-privacy-key")
      sessionRemove("bitbudget-privacy-user")
      hex = null
      cachedUser = null
    }
  }

  const res = await fetch("/api/user/encryption")
  if (res.status === 401 || res.status === 403 || !res.ok) return null

  const data = (await res.json()) as EncApiPayload

  hex = sessionGet("bitbudget-privacy-key")
  cachedUser = sessionGet("bitbudget-privacy-user")

  if (hex && cachedUser === data.userId) {
    try {
      return encryptFnFromHexKey(hex)
    } catch {
      sessionRemove("bitbudget-privacy-key")
      sessionRemove("bitbudget-privacy-user")
    }
  } else if (cachedUser && cachedUser !== data.userId) {
    sessionRemove("bitbudget-privacy-key")
    sessionRemove("bitbudget-privacy-user")
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
        sessionSet("bitbudget-privacy-key", hexKey)
        sessionSet("bitbudget-privacy-user", data.userId)
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
        sessionSet("bitbudget-privacy-key", hexKey)
        sessionSet("bitbudget-privacy-user", data.userId)
        void syncUserPublicKey(pk)
        return encryptFnFromHexKey(hexKey)
      } catch {
        /* wrong key or corrupt ciphertext */
      }
    }
  }

  return null
}
