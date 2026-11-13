import { withShoppingUser } from "@/lib/shopping-api"
import { shoppingJson } from "@/lib/shopping-http"
import { createInvite } from "@/lib/shopping-server"

export async function POST(_req: Request, ctx: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await ctx.params
  return withShoppingUser(async (userId) => {
    const { invite, token, ownerPublicKey } = await createInvite({ groupId, userId })
    return shoppingJson({
      id: invite.id,
      token,
      ownerPublicKey,
      expiresAt: invite.expiresAt.toISOString(),
    }, 201)
  })
}
