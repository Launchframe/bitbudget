import { walletRoute, walletUser, requireWalletOrigin, walletBody } from "@/lib/wallet/server/http"
import { authenticationVerifySchema } from "@/lib/wallet/server/schemas"
import { authenticationVerify } from "@/lib/wallet/server/credentials"

export const runtime = "nodejs"

export async function POST(request: Request) {
  return walletRoute(async () => {
    const userId = await walletUser()
    const origin = requireWalletOrigin(request)
    const body = await walletBody(request, authenticationVerifySchema)
    return authenticationVerify(userId, body.network, origin, body.challengeId, body.response)
  })
}
