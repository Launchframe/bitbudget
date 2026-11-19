import { withShoppingUser } from "@/lib/shopping-api"
import { shoppingJson } from "@/lib/shopping-http"
import { getClaimantKey } from "@/lib/shopping-server"

export async function GET(_req: Request, ctx: { params: Promise<{ groupId: string; inviteId: string }> }) {
  const { groupId, inviteId } = await ctx.params
  return withShoppingUser(async (userId) => {
    const data = await getClaimantKey({ groupId, userId, inviteId })
    return shoppingJson(data)
  })
}
