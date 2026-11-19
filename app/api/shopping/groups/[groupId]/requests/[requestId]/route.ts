import { withShoppingUser } from "@/lib/shopping-api"
import { readShoppingJson, requirePositiveInt, requireShoppingCiphertext, shoppingJson } from "@/lib/shopping-http"
import { updateRequest } from "@/lib/shopping-server"

export async function PATCH(req: Request, ctx: { params: Promise<{ groupId: string; requestId: string }> }) {
  const { groupId, requestId } = await ctx.params
  return withShoppingUser(async (userId) => {
    const parsed = await readShoppingJson(req)
    if (!parsed.ok) return parsed.response
    const encryptedPayload = requireShoppingCiphertext(parsed.body.encryptedPayload, "Item")
    if (typeof encryptedPayload !== "string") return encryptedPayload
    const expectedRevision = requirePositiveInt(parsed.body.expectedRevision)
    const keyVersion = requirePositiveInt(parsed.body.keyVersion)
    if (expectedRevision == null || expectedRevision < 1) {
      return shoppingJson({ error: "Invalid revision" }, 400)
    }
    if (keyVersion == null || keyVersion < 1) return shoppingJson({ error: "Invalid key version" }, 400)
    const request = await updateRequest({
      groupId,
      userId,
      requestId,
      expectedRevision,
      encryptedPayload,
      keyVersion,
      tombstone: parsed.body.tombstone === true,
      checkoffOnly: parsed.body.checkoffOnly === true,
    })
    return shoppingJson({
      id: request.id,
      revision: request.revision,
      tombstone: request.tombstone,
      updatedAt: request.updatedAt.toISOString(),
    })
  })
}
