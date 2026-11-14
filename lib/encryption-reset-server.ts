/**
 * Destructive encryption recovery for signed-in users who lost their passphrase.
 * Ciphertext tied to the old key is removed — never silently rotated via
 * POST /api/user/encryption.
 */

import { prisma } from "@/lib/db"
import {
  type EncryptionResetMode,
  ENCRYPTION_RESET_CONFIRM,
  parseEncryptionResetMode,
} from "@/lib/encryption-reset"
import { suppressAllShoppingPostingsForUser } from "@/lib/shopping-posting-server"

export { ENCRYPTION_RESET_CONFIRM, parseEncryptionResetMode, type EncryptionResetMode }

/** Session must have been issued within this window (step-up via fresh sign-in). */
export const ENCRYPTION_RESET_MAX_SESSION_AGE_SEC = 15 * 60

/** True when JWT `iat` is missing or older than the reset step-up window. */
export function encryptionResetRequiresReauth(
  iat: number | null | undefined,
  nowSec: number,
): boolean {
  if (typeof iat !== "number" || !Number.isFinite(iat)) return true
  return nowSec - iat > ENCRYPTION_RESET_MAX_SESSION_AGE_SEC
}

export async function resetUserEncryption(params: {
  userId: string
  mode: EncryptionResetMode
}): Promise<{ mode: EncryptionResetMode; transactionsDeleted: number; envelopesDeleted: number }> {
  const { userId, mode } = params

  const result = await prisma.$transaction(async (tx) => {
    // Same transaction as the key wipe. A failure must not leave postings suppressed
    // while the old passphrase and ciphertext are still in place.
    await suppressAllShoppingPostingsForUser(userId, tx)

    // Rows with encrypted payee/notes (or ciphertext JSON) become unreadable after key wipe.
    const txnDelete = await tx.transaction.deleteMany({ where: { userId } })
    await tx.pendingTransaction.deleteMany({ where: { userId } })
    await tx.transactionShortcut.deleteMany({ where: { userId } })
    await tx.recurringTransaction.deleteMany({ where: { userId } })
    await tx.pendingStatementBatch.deleteMany({ where: { userId } })
    // Funding/sweep idempotency — empty ledger must not skip the next payday/1st.
    await tx.envelopeFundingBatch.deleteMany({ where: { userId } })

    // Old privacy key seals shopping member wraps; drop wraps so lists stay inaccessible
    // until the user rejoins with the new key (UI discloses this).
    await tx.shoppingMemberKey.deleteMany({
      where: { member: { userId } },
    })

    let envelopesDeleted = 0
    if (mode === "all_data") {
      await tx.payeeDisplayAlias.deleteMany({ where: { userId } })
      await tx.recurringFundingRule.deleteMany({ where: { userId } })
      await tx.savingsGoal.deleteMany({ where: { userId } })
      await tx.userAchievement.deleteMany({ where: { userId } })
      await tx.tag.deleteMany({ where: { userId } })
      // Envelopes cascade remaining payee mappings (same shape as Settings clear-all).
      const envDelete = await tx.envelope.deleteMany({ where: { userId } })
      envelopesDeleted = envDelete.count
    }

    await tx.user.update({
      where: { id: userId },
      data: {
        encryptedPrivacyKey: null,
        privacyKeySalt: null,
        // Force clients to treat this as "must set a new key" even after refresh.
        publicKey: null,
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
