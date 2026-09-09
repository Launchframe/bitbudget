import { withShoppingUser } from "@/lib/shopping-api"
import { shoppingJson } from "@/lib/shopping-http"
import { getGroupSnapshot, removeOrLeaveMember, requireActiveMember } from "@/lib/shopping-server"

export async function GET(_req: Request, ctx: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await ctx.params
  return withShoppingUser(async (userId) => {
    const snapshot = await getGroupSnapshot(groupId, userId)
    return shoppingJson(snapshot)
  })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await ctx.params
  return withShoppingUser(async (userId) => {
    const me = await requireActiveMember(groupId, userId)
    await removeOrLeaveMember({
      groupId,
      actorUserId: userId,
      targetMemberId: me.id,
      leaving: true,
    })
    return shoppingJson({ left: true })
  })
}
