import { walletRoute, walletUser, requireWalletOrigin, walletBody } from "@/lib/wallet/server/http"
import { walletIdSchema } from "@/lib/wallet/server/schemas"
import { spendCommitSchema } from "@/lib/wallet/spend-request"
import { cosignSpend } from "@/lib/wallet/server/signing"
import { requireCustodyTier } from "@/lib/wallet/server/tier"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Co-sign one spend request. Requires a passkey grant bound to the request
 * digest (see `/api/wallets/credentials/authentication/*` with `operation: "sign"`).
 * Premium/trial only; recovery paths stay ungated elsewhere.
 */
export async function POST(request: Request, { params }: { params: Promise<{ walletId: string }> }) {
  return walletRoute(async () => {
    const userId = await walletUser()
    const origin = requireWalletOrigin(request)
    await requireCustodyTier(userId)
    const walletId = walletIdSchema.parse((await params).walletId)
    return cosignSpend(userId, walletId, origin, await walletBody(request, spendCommitSchema))
  })
}
