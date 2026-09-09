import { withShoppingUser } from "@/lib/shopping-api"
import { readShoppingJson, requirePositiveInt, requireShoppingCiphertext, shoppingJson } from "@/lib/shopping-http"
import { createList } from "@/lib/shopping-server"

export async function POST(req: Request, ctx: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await ctx.params
  return withShoppingUser(async (userId) => {
    const parsed = await readShoppingJson(req)
    if (!parsed.ok) return parsed.response
    const encryptedPayload = requireShoppingCiphertext(parsed.body.encryptedPayload, "List")
    if (typeof encryptedPayload !== "string") return encryptedPayload
    const keyVersion = requirePositiveInt(parsed.body.keyVersion)
    if (keyVersion == null || keyVersion < 1) return shoppingJson({ error: "Invalid key version" }, 400)
    const list = await createList({ groupId, userId, encryptedPayload, keyVersion })
    return shoppingJson({
      id: list.id,
      revision: list.revision,
      keyVersion: list.keyVersion,
      updatedAt: list.updatedAt.toISOString(),
    }, 201)
  })
}
