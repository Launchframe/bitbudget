import { withShoppingUser } from "@/lib/shopping-api"
import { readShoppingJson, requirePositiveInt, requireShoppingCiphertext, shoppingJson } from "@/lib/shopping-http"
import { updateList } from "@/lib/shopping-server"

export async function PATCH(req: Request, ctx: { params: Promise<{ groupId: string; listId: string }> }) {
  const { groupId, listId } = await ctx.params
  return withShoppingUser(async (userId) => {
    const parsed = await readShoppingJson(req)
    if (!parsed.ok) return parsed.response
    const encryptedPayload = requireShoppingCiphertext(parsed.body.encryptedPayload, "List")
    if (typeof encryptedPayload !== "string") return encryptedPayload
    const expectedRevision = requirePositiveInt(parsed.body.expectedRevision)
    const keyVersion = requirePositiveInt(parsed.body.keyVersion)
    if (expectedRevision == null || expectedRevision < 1) {
      return shoppingJson({ error: "Invalid revision" }, 400)
    }
    if (keyVersion == null || keyVersion < 1) return shoppingJson({ error: "Invalid key version" }, 400)
    const list = await updateList({
      groupId,
      userId,
      listId,
      expectedRevision,
      encryptedPayload,
      keyVersion,
      tombstone: parsed.body.tombstone === true,
    })
    return shoppingJson({
      id: list.id,
      revision: list.revision,
      keyVersion: list.keyVersion,
      tombstone: list.tombstone,
      updatedAt: list.updatedAt.toISOString(),
    })
  })
}
