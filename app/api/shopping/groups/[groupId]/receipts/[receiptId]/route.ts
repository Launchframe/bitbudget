import { withShoppingUser } from "@/lib/shopping-api"
import { readShoppingJson, requirePositiveInt, requireShoppingCiphertext, shoppingJson } from "@/lib/shopping-http"
import { appendShoppingEvent, upsertReceiptDraft } from "@/lib/shopping-server"
import { isShoppingEventType } from "@/lib/shopping-types"

export async function PATCH(req: Request, ctx: { params: Promise<{ groupId: string; receiptId: string }> }) {
  const { groupId, receiptId } = await ctx.params
  return withShoppingUser(async (userId) => {
    const parsed = await readShoppingJson(req)
    if (!parsed.ok) return parsed.response
    const encryptedPayload = requireShoppingCiphertext(parsed.body.encryptedPayload, "Receipt")
    if (typeof encryptedPayload !== "string") return encryptedPayload
    const payerMemberId = parsed.body.payerMemberId
    const keyVersion = requirePositiveInt(parsed.body.keyVersion)
    const expectedRevision = requirePositiveInt(parsed.body.expectedRevision)
    if (typeof payerMemberId !== "string") return shoppingJson({ error: "Choose who paid" }, 400)
    if (keyVersion == null || keyVersion < 1) return shoppingJson({ error: "Invalid key version" }, 400)
    if (expectedRevision == null || expectedRevision < 1) return shoppingJson({ error: "Invalid revision" }, 400)
    let frozen: string | null | undefined
    if (parsed.body.frozenRequestSnapshot != null) {
      const snap = requireShoppingCiphertext(parsed.body.frozenRequestSnapshot, "Receipt snapshot")
      if (typeof snap !== "string") return snap
      frozen = snap
    }
    const receipt = await upsertReceiptDraft({
      groupId,
      userId,
      receiptId,
      payerMemberId,
      encryptedPayload,
      keyVersion,
      expectedRevision,
      listId: typeof parsed.body.listId === "string" ? parsed.body.listId : undefined,
      frozenRequestSnapshot: frozen,
    })
    return shoppingJson({
      id: receipt.id,
      revision: receipt.revision,
      status: receipt.status,
      updatedAt: receipt.updatedAt.toISOString(),
    })
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ groupId: string; receiptId: string }> }) {
  const { groupId, receiptId } = await ctx.params
  return withShoppingUser(async (userId) => {
    const parsed = await readShoppingJson(req)
    if (!parsed.ok) return parsed.response
    if (parsed.body.action !== "finalize") {
      return shoppingJson({ error: "Unknown action" }, 400)
    }
    const encryptedPayload = requireShoppingCiphertext(parsed.body.encryptedPayload, "Event")
    if (typeof encryptedPayload !== "string") return encryptedPayload
    const expectedSequence = requirePositiveInt(parsed.body.expectedSequence)
    const keyVersion = requirePositiveInt(parsed.body.keyVersion)
    const operationId = parsed.body.operationId
    const payerMemberId = parsed.body.payerMemberId
    if (expectedSequence == null) return shoppingJson({ error: "Invalid sequence" }, 400)
    if (keyVersion == null || keyVersion < 1) return shoppingJson({ error: "Invalid key version" }, 400)
    if (typeof operationId !== "string") return shoppingJson({ error: "Missing operation id" }, 400)
    if (typeof payerMemberId !== "string") return shoppingJson({ error: "Choose who paid" }, 400)
    const type = parsed.body.type
    if (!isShoppingEventType(type) || type !== "receipt_finalized") {
      return shoppingJson({ error: "Invalid event type" }, 400)
    }
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
      receiptId,
      payerMemberId,
    })
    return shoppingJson({
      id: result.event.id,
      sequence: result.event.sequence,
      idempotent: result.idempotent,
    })
  })
}
