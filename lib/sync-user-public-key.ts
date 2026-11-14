import { generateKeyPairFromSeed, publicKeyToHex } from "@/lib/crypto"
import { shouldApplyUnlock } from "@/lib/encryption-unlock-fence"

/** Upload NaCl public key derived from privacy key if server is missing or out of sync. */
export async function syncUserPublicKey(
  privacyKey: Uint8Array,
  fenceAtMount?: number,
): Promise<void> {
  if (fenceAtMount !== undefined && !shouldApplyUnlock(fenceAtMount)) return
  const { publicKey } = generateKeyPairFromSeed(privacyKey)
  const hex = publicKeyToHex(publicKey)
  try {
    const res = await fetch("/api/user/public-key")
    if (!res.ok) return
    if (fenceAtMount !== undefined && !shouldApplyUnlock(fenceAtMount)) return
    const data = (await res.json()) as { publicKey: string | null }
    if (data.publicKey === hex) return
    if (fenceAtMount !== undefined && !shouldApplyUnlock(fenceAtMount)) return
    await fetch("/api/user/public-key", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey: hex }),
    })
  } catch {
    /* ignore */
  }
}
