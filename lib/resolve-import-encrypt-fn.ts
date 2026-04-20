"use client"

import { getSession } from "next-auth/react"
import {
  encryptFieldAsymmetric,
  generateKeyPairFromSeed,
  hexToUint8,
} from "@/lib/crypto"
import {
  clearPrivacyKeyCache,
  getValidCachedPrivacyKeyHex,
  setCachedPrivacyKeyHex,
} from "@/lib/privacy-key-storage"
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
 * - Fast path: valid cached key (localStorage TTL + legacy session migration) + session user id match.
 * - Otherwise fetches encryption metadata; for Nostr extension accounts may run
 *   NIP-04 decrypt. This fixes onboarding import when storage was cleared or the key was
 *   never written, as long as the server-stored ciphertext is valid for the current pubkey.
 */
export async function resolveEncryptFnForImport(): Promise<ImportEncryptFn | null> {
  if (typeof window === "undefined") return null

  const session = await getSession()
  const sid = session?.user?.id
  if (sid) {
    const hex = getValidCachedPrivacyKeyHex(sid)
    if (hex) {
      try {
        return encryptFnFromHexKey(hex)
      } catch {
        clearPrivacyKeyCache()
      }
    }
  }

  const res = await fetch("/api/user/encryption")
  if (res.status === 401 || res.status === 403 || !res.ok) return null

  const data = (await res.json()) as EncApiPayload

  const hexAfterFetch = getValidCachedPrivacyKeyHex(data.userId)
  if (hexAfterFetch) {
    try {
      return encryptFnFromHexKey(hexAfterFetch)
    } catch {
      clearPrivacyKeyCache()
    }
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
        setCachedPrivacyKeyHex(data.userId, hexKey)
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
        setCachedPrivacyKeyHex(data.userId, hexKey)
        void syncUserPublicKey(pk)
        return encryptFnFromHexKey(hexKey)
      } catch {
        /* wrong key or corrupt ciphertext */
      }
    }
  }

  return null
}
