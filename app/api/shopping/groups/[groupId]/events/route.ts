import { withShoppingUser } from "@/lib/shopping-api"
import { readShoppingJson, requirePositiveInt, requireShoppingCiphertext, shoppingJson } from "@/lib/shopping-http"
import { appendShoppingEvent, listShoppingEvents } from "@/lib/shopping-server"
import { isShoppingEventType } from "@/lib/shopping-types"

export async function GET(req: Request, ctx: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await ctx.params
  const url = new URL(req.url)
  const afterRaw = url.searchParams.get("afterSequence")
  const beforeRaw = url.searchParams.get("beforeSequence")
  let afterSequence: number | null = null
  let beforeSequence: number | null = null
  if (afterRaw != null && afterRaw !== "") {
    const parsed = Number(afterRaw)
    if (!Number.isInteger(parsed) || parsed < 0) {
      return shoppingJson({ error: "Invalid sequence cursor" }, 400)
    }
    afterSequence = parsed
  }
  if (beforeRaw != null && beforeRaw !== "") {
    const parsed = Number(beforeRaw)
    if (!Number.isInteger(parsed) || parsed < 0) {
      return shoppingJson({ error: "Invalid sequence cursor" }, 400)
    }
    beforeSequence = parsed
  }
  if (afterSequence != null && beforeSequence != null) {
    return shoppingJson({ error: "Choose either newer or earlier items, not both." }, 400)
  }
  if (afterSequence == null && beforeSequence == null) afterSequence = 0
  return withShoppingUser(async (userId) => {
    const page = await listShoppingEvents({ groupId, userId, afterSequence, beforeSequence })
    return shoppingJson(page)
  })
}

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
