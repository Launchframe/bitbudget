import { walletRoute, walletUser, requireWalletOrigin, walletBody } from "@/lib/wallet/server/http"
import { registrationVerifySchema } from "@/lib/wallet/server/schemas"
import { registrationVerify } from "@/lib/wallet/server/credentials"

export const runtime = "nodejs"

export async function POST(request: Request) {
  return walletRoute(async () => {
    const userId = await walletUser()
    const origin = requireWalletOrigin(request)
    const body = await walletBody(request, registrationVerifySchema)
    return registrationVerify(userId, body.network, origin, body.challengeId, body.response)
  })
}
