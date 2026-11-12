import { walletRoute, walletUser } from "@/lib/wallet/server/http"
import { walletIdSchema } from "@/lib/wallet/server/schemas"
import { walletStatus } from "@/lib/wallet/server/wallets"
import { WalletError } from "@/lib/wallet/server/config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_request: Request, context: { params: Promise<{ walletId: string }> }) {
  return walletRoute(async () => {
    const userId = await walletUser()
    const { walletId } = await context.params
    if (!walletIdSchema.safeParse(walletId).success) throw new WalletError(404, "wallet-not-found")
    return walletStatus(userId, walletId)
  })
}
