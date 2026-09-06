import { walletRoute, walletUser, requireWalletOrigin, walletBody } from "@/lib/wallet/server/http"
import { registrationOptionsSchema } from "@/lib/wallet/server/schemas"
import { registrationOptions } from "@/lib/wallet/server/credentials"

export const runtime = "nodejs"

export async function POST(request: Request) {
  return walletRoute(async () => {
    const userId = await walletUser()
    const origin = requireWalletOrigin(request)
    const body = await walletBody(request, registrationOptionsSchema)
    return registrationOptions(userId, body.network, origin)
  })
}
