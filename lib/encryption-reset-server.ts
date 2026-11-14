/**
 * Destructive encryption recovery for signed-in users who lost their passphrase.
 * Session auth is the identity proof. Ciphertext tied to the old key is removed —
 * never silently rotated via POST /api/user/encryption.
 */

import { prisma } from "@/lib/db"
import {
  type EncryptionResetMode,
  ENCRYPTION_RESET_CONFIRM,
  parseEncryptionResetMode,
} from "@/lib/encryption-reset"
import { suppressAllShoppingPostingsForUser } from "@/lib/shopping-posting-server"

export { ENCRYPTION_RESET_CONFIRM, parseEncryptionResetMode, type EncryptionResetMode }

export async function resetUserEncryption(params: {
  userId: string
  mode: EncryptionResetMode
}): Promise<{ mode: EncryptionResetMode; transactionsDeleted: number; envelopesDeleted: number }> {
  const { userId, mode } = params

  await suppressAllShoppingPostingsForUser(userId)

  const result = await prisma.$transaction(async (tx) => {
    // Rows with encrypted payee/notes (or ciphertext JSON) become unreadable after key wipe.
    const txnDelete = await tx.transaction.deleteMany({ where: { userId } })
    await tx.pendingTransaction.deleteMany({ where: { userId } })
    await tx.transactionShortcut.deleteMany({ where: { userId } })
    await tx.recurringTransaction.deleteMany({ where: { userId } })
    await tx.pendingStatementBatch.deleteMany({ where: { userId } })

    let envelopesDeleted = 0
    if (mode === "all_data") {
      // Pending / shortcuts already removed above. Envelopes cascade remaining
      // transactions/recurring/payee mappings (same shape as Settings clear-all).
      await tx.payeeDisplayAlias.deleteMany({ where: { userId } })
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
