import { walletRoute, walletUser, requireWalletOrigin, walletBody } from "@/lib/wallet/server/http"
import { authenticationOptionsSchema } from "@/lib/wallet/server/schemas"
import { authenticationOptions } from "@/lib/wallet/server/credentials"

export const runtime = "nodejs"

export async function POST(request: Request) {
  return walletRoute(async () => {
    const userId = await walletUser()
    const origin = requireWalletOrigin(request)
    const body = await walletBody(request, authenticationOptionsSchema)
    return authenticationOptions(userId, body.network, origin)
  })
}
