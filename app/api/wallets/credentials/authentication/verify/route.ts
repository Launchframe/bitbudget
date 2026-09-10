import { walletRoute, walletUser, requireWalletOrigin, walletBody } from "@/lib/wallet/server/http"
import { authenticationVerifySchema } from "@/lib/wallet/server/schemas"
import { authenticationVerify } from "@/lib/wallet/server/credentials"
import { requireCustodyTier } from "@/lib/wallet/server/tier"

export const runtime = "nodejs"

export async function POST(request: Request) {
  return walletRoute(async () => {
    const userId = await walletUser()
    const origin = requireWalletOrigin(request)
    const body = await walletBody(request, authenticationVerifySchema)
    if (body.operation === "sign") {
      await requireCustodyTier(userId)
      return authenticationVerify(userId, body.network, origin, body.challengeId, body.response, body.walletId, { lineage: body.lineage, digest: body.digest })
    }
    return authenticationVerify(userId, body.network, origin, body.challengeId, body.response, body.operation === "unlock" ? body.walletId : null)
  })
}
