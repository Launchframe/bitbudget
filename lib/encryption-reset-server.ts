/**
 * Destructive encryption recovery for signed-in users who lost their passphrase.
 * Session auth is the identity proof. Ciphertext tied to the old key is removed or
 * left undecryptable — never silently rotated via POST /api/user/encryption.
 */

import { prisma } from "@/lib/db"
import { suppressAllShoppingPostingsForUser } from "@/lib/shopping-posting-server"

export const ENCRYPTION_RESET_CONFIRM = "RESET"
export type EncryptionResetMode = "encrypted_data" | "all_data"

export function parseEncryptionResetMode(value: unknown): EncryptionResetMode | null {
  if (value === "encrypted_data" || value === "all_data") return value
  return null
}

export async function resetUserEncryption(params: {
  userId: string
  mode: EncryptionResetMode
}): Promise<{ mode: EncryptionResetMode; transactionsDeleted: number; envelopesDeleted: number }> {
  const { userId, mode } = params

  await suppressAllShoppingPostingsForUser(userId)

  const result = await prisma.$transaction(async (tx) => {
    const txnDelete = await tx.transaction.deleteMany({ where: { userId } })
    await tx.pendingTransaction.deleteMany({ where: { userId } })

    let envelopesDeleted = 0
    if (mode === "all_data") {
      await tx.pendingTransaction.updateMany({
        where: { userId },
        data: { suggestedEnvelopeId: null },
      })
      await tx.transactionShortcut.deleteMany({ where: { userId } })
      const envDelete = await tx.envelope.deleteMany({ where: { userId } })
      envelopesDeleted = envDelete.count
    }

    await tx.user.update({
      where: { id: userId },
      data: {
        encryptedPrivacyKey: null,
        privacyKeySalt: null,
      },
    })

    return {
      mode,
      transactionsDeleted: txnDelete.count,
      envelopesDeleted,
    }
  })

  return result
}
