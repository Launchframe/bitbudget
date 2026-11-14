import {
  decryptFieldAsymmetric,
  generateKeyPairFromSeed,
  publicKeyToHex,
} from "@/lib/crypto"

/** Upload NaCl public key derived from privacy key if server is missing or out of sync. */
export async function syncUserPublicKey(privacyKey: Uint8Array): Promise<void> {
  const { publicKey, secretKey } = generateKeyPairFromSeed(privacyKey)
  const hex = publicKeyToHex(publicKey)
  try {
    const res = await fetch("/api/user/public-key")
    if (!res.ok) return
    const data = (await res.json()) as { publicKey: string | null }
    if (data.publicKey === hex) return

    const challengeRes = await fetch("/api/user/public-key/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey: hex }),
    })
    if (!challengeRes.ok) return
    const challengeBody = (await challengeRes.json()) as {
      challengeToken?: string
      sealedChallenge?: string
    }
    if (
      typeof challengeBody.challengeToken !== "string" ||
      typeof challengeBody.sealedChallenge !== "string"
    ) {
      return
    }
    const challenge = decryptFieldAsymmetric(challengeBody.sealedChallenge, secretKey)
    await fetch("/api/user/public-key", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey: hex,
        challengeToken: challengeBody.challengeToken,
        challenge,
      }),
    })
  } catch {
    /* ignore */
  }
}
