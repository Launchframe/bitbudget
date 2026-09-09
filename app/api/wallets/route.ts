import { walletRoute, walletUser, requireWalletOrigin, walletBody } from "@/lib/wallet/server/http"
import { startProvisioning, startProvisioningSchema } from "@/lib/wallet/server/provisioning"
import { listWallets } from "@/lib/wallet/server/wallets"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  return walletRoute(async () => listWallets(await walletUser(), new URL(request.url).origin))
}

export async function POST(request: Request) {
  return walletRoute(async () => {
    const userId = await walletUser()
    requireWalletOrigin(request)
    const body = await walletBody(request, startProvisioningSchema)
    return startProvisioning(userId, body)
  })
}
