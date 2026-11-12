import { requirePremiumOrTrial } from "@/lib/subscription"
import { WalletError } from "@/lib/wallet/server/config"

/**
 * Product tiers for the wallet hub:
 *  - Watch-only tracking of pasted xpubs (the accounting layer) is available to
 *    every account and never touches these helpers.
 *  - Creating a BitBudget custody wallet (passkey + co-signer + recovery file)
 *    is a Trial / Premium feature. Creation entry points call
 *    {@link requireCustodyTier}; the hub reads {@link custodyTierAllowed} from
 *    `GET /api/wallets` so the client never infers tier on its own.
 *
 * Existing wallets stay readable and recoverable if a subscription lapses:
 * status, recovery and authentication routes are deliberately *not* gated.
 */
export async function custodyTierAllowed(userId: string): Promise<boolean> {
  try {
    return await requirePremiumOrTrial(userId)
  } catch {
    return false
  }
}

export async function requireCustodyTier(userId: string): Promise<void> {
  if (!(await custodyTierAllowed(userId))) throw new WalletError(403, "tier-required")
}
