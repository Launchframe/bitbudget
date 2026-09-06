import { walletBody, walletRoute, walletUser, requireWalletOrigin } from "@/lib/wallet/server/http"
import { walletIdSchema } from "@/lib/wallet/server/schemas"
import { recoveryVerify, recoveryVerifySchema } from "@/lib/wallet/server/recovery"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request, { params }: { params: Promise<{ walletId: string }> }) {
  return walletRoute(async () => {
    const userId = await walletUser()
    const origin = requireWalletOrigin(request)
    const walletId = walletIdSchema.parse((await params).walletId)
    return recoveryVerify(userId, walletId, origin, await walletBody(request, recoveryVerifySchema))
  })
}
