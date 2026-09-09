import { withShoppingUser } from "@/lib/shopping-api"
import { readShoppingJson, requirePositiveInt, requireShoppingCiphertext, shoppingJson } from "@/lib/shopping-http"
import { appendShoppingEvent } from "@/lib/shopping-server"
import { isShoppingEventType } from "@/lib/shopping-types"

export async function POST(req: Request, ctx: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await ctx.params
  return withShoppingUser(async (userId) => {
    const parsed = await readShoppingJson(req)
    if (!parsed.ok) return parsed.response
    const encryptedPayload = requireShoppingCiphertext(parsed.body.encryptedPayload, "Event")
    if (typeof encryptedPayload !== "string") return encryptedPayload
    const expectedSequence = requirePositiveInt(parsed.body.expectedSequence)
    const keyVersion = requirePositiveInt(parsed.body.keyVersion)
    const operationId = parsed.body.operationId
    const type = parsed.body.type
    if (expectedSequence == null) return shoppingJson({ error: "Invalid sequence" }, 400)
    if (keyVersion == null || keyVersion < 1) return shoppingJson({ error: "Invalid key version" }, 400)
    if (typeof operationId !== "string") return shoppingJson({ error: "Missing operation id" }, 400)
    if (!isShoppingEventType(type)) return shoppingJson({ error: "Unknown event type" }, 400)
    const affectedMemberIds = Array.isArray(parsed.body.affectedMemberIds)
      ? parsed.body.affectedMemberIds.filter((id): id is string => typeof id === "string")
      : []
    const result = await appendShoppingEvent({
      groupId,
      userId,
      expectedSequence,
      type,
      encryptedPayload,
      keyVersion,
      operationId,
      affectedMemberIds,
    })
    return shoppingJson({
      id: result.event.id,
      sequence: result.event.sequence,
      idempotent: result.idempotent,
    })
  })
}
