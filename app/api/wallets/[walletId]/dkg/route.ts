import { walletBody, walletRoute, walletUser, requireWalletOrigin } from "@/lib/wallet/server/http"
import { walletIdSchema } from "@/lib/wallet/server/schemas"
import { finishProvisioning, finishProvisioningSchema } from "@/lib/wallet/server/provisioning"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request, { params }: { params: Promise<{ walletId: string }> }) {
  return walletRoute(async () => {
    const userId = await walletUser()
    requireWalletOrigin(request)
    const walletId = walletIdSchema.parse((await params).walletId)
    return finishProvisioning(userId, walletId, await walletBody(request, finishProvisioningSchema))
  })
}
