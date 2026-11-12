import { walletRoute, walletUser, requireWalletOrigin, walletBody } from "@/lib/wallet/server/http"
import { registrationVerifySchema } from "@/lib/wallet/server/schemas"
import { registrationVerify } from "@/lib/wallet/server/credentials"
import { requireCustodyTier } from "@/lib/wallet/server/tier"

export const runtime = "nodejs"

export async function POST(request: Request) {
  return walletRoute(async () => {
    const userId = await walletUser()
    const origin = requireWalletOrigin(request)
    await requireCustodyTier(userId)
    const body = await walletBody(request, registrationVerifySchema)
    return registrationVerify(userId, body.network, origin, body.challengeId, body.response)
  })
}
