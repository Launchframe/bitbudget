import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { encryptionKey, testNetworkSchema, WalletError } from "@/lib/wallet/server/config"

export interface CosignerBinding {
  userId: string
  walletId: string
  network: string
  publicPackageHash: string
  purpose?: "share" | "dkg-state" | "dkg-response"
}

function aad(binding: CosignerBinding) {
  if (!binding.userId || !binding.walletId || !testNetworkSchema.safeParse(binding.network).success ||
      !/^[0-9a-f]{64}$/.test(binding.publicPackageHash)) throw new WalletError(400, "invalid-binding")
  const purpose = binding.purpose ?? "share"
  if (!["share", "dkg-state", "dkg-response"].includes(purpose)) throw new WalletError(400, "invalid-binding")
  return Buffer.from(JSON.stringify(["bitbudget-wallet-B", 1, binding.userId, binding.walletId, binding.network, binding.publicPackageHash, purpose]))
}

export function wrapCosignerShare(plaintext: Uint8Array, binding: CosignerBinding): Buffer {
  const key = encryptionKey()
  try {
    if (!plaintext.length || plaintext.length > 16384) throw new WalletError(400, "invalid-share")
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", key, iv)
    cipher.setAAD(aad(binding))
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext])
  } finally {
    key.fill(0)
  }
}

export function unwrapCosignerShare(envelope: Uint8Array, binding: CosignerBinding): Buffer {
  const key = encryptionKey()
  try {
    if (envelope.length <= 29 || envelope.length > 16413 || envelope[0] !== 1) throw new Error("Invalid envelope")
    const decipher = createDecipheriv("aes-256-gcm", key, envelope.subarray(1, 13))
    decipher.setAAD(aad(binding))
    decipher.setAuthTag(envelope.subarray(13, 29))
    const partial = decipher.update(envelope.subarray(29))
    let final: Buffer | undefined
    try {
      final = decipher.final()
      return Buffer.concat([partial, final])
    } finally {
      partial.fill(0)
      final?.fill(0)
    }
  } catch {
    throw new WalletError(503, "cosigner-unavailable")
  } finally {
    key.fill(0)
  }
}
