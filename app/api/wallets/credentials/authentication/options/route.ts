import { walletRoute, walletUser, requireWalletOrigin, walletBody } from "@/lib/wallet/server/http"
import { authenticationOptionsSchema } from "@/lib/wallet/server/schemas"
import { authenticationOptions } from "@/lib/wallet/server/credentials"
import { requireCustodyTier } from "@/lib/wallet/server/tier"

export const runtime = "nodejs"

export async function POST(request: Request) {
  return walletRoute(async () => {
    const userId = await walletUser()
    const origin = requireWalletOrigin(request)
    const body = await walletBody(request, authenticationOptionsSchema)
    if (body.operation === "sign") {
      // Spending is a Premium/trial capability; unlock (recovery) and create stay governed elsewhere.
      await requireCustodyTier(userId)
      return authenticationOptions(userId, body.network, origin, body.walletId, { lineage: body.lineage, digest: body.digest })
    }
    return authenticationOptions(userId, body.network, origin, body.operation === "unlock" ? body.walletId : null)
  })
}
