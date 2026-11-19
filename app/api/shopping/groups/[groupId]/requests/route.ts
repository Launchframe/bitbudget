import { withShoppingUser } from "@/lib/shopping-api"
import { readShoppingJson, requirePositiveInt, requireShoppingCiphertext, shoppingJson } from "@/lib/shopping-http"
import { createRequest } from "@/lib/shopping-server"

export async function POST(req: Request, ctx: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await ctx.params
  return withShoppingUser(async (userId) => {
    const parsed = await readShoppingJson(req)
    if (!parsed.ok) return parsed.response
    const encryptedPayload = requireShoppingCiphertext(parsed.body.encryptedPayload, "Item")
    if (typeof encryptedPayload !== "string") return encryptedPayload
    const listId = parsed.body.listId
    const requesterMemberId = parsed.body.requesterMemberId
    const keyVersion = requirePositiveInt(parsed.body.keyVersion)
    if (typeof listId !== "string" || typeof requesterMemberId !== "string") {
      return shoppingJson({ error: "Missing list or requester" }, 400)
    }
    if (keyVersion == null || keyVersion < 1) return shoppingJson({ error: "Invalid key version" }, 400)
    const request = await createRequest({
      groupId,
      userId,
      listId,
      requesterMemberId,
      encryptedPayload,
      keyVersion,
      id: typeof parsed.body.id === "string" ? parsed.body.id : undefined,
    })
    return shoppingJson({
      id: request.id,
      listId: request.listId,
      revision: request.revision,
      requesterMemberId: request.requesterMemberId,
      authorMemberId: request.authorMemberId,
      updatedAt: request.updatedAt.toISOString(),
    }, 201)
  })
}
