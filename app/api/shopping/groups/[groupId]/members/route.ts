import { withShoppingUser } from "@/lib/shopping-api"
import { readShoppingJson, shoppingJson } from "@/lib/shopping-http"
import { removeOrLeaveMember } from "@/lib/shopping-server"

export async function DELETE(req: Request, ctx: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await ctx.params
  return withShoppingUser(async (userId) => {
    const parsed = await readShoppingJson(req)
    if (!parsed.ok) return parsed.response
    const targetMemberId = parsed.body.memberId
    if (typeof targetMemberId !== "string") {
      return shoppingJson({ error: "Missing member" }, 400)
    }
    await removeOrLeaveMember({
      groupId,
      actorUserId: userId,
      targetMemberId,
      leaving: false,
    })
    return shoppingJson({ removed: true })
  })
}
