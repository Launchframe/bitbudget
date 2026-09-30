import { withShoppingUser } from "@/lib/shopping-api"
import { readShoppingJson, requirePositiveInt, requireShoppingCiphertext, shoppingJson } from "@/lib/shopping-http"
import { upsertReceiptDraft } from "@/lib/shopping-server"

export async function POST(req: Request, ctx: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await ctx.params
  return withShoppingUser(async (userId) => {
    const parsed = await readShoppingJson(req)
    if (!parsed.ok) return parsed.response
    const encryptedPayload = requireShoppingCiphertext(parsed.body.encryptedPayload, "Receipt")
    if (typeof encryptedPayload !== "string") return encryptedPayload
    const payerMemberId = parsed.body.payerMemberId
    const keyVersion = requirePositiveInt(parsed.body.keyVersion)
    if (typeof payerMemberId !== "string") return shoppingJson({ error: "Choose who paid" }, 400)
    if (keyVersion == null || keyVersion < 1) return shoppingJson({ error: "Invalid key version" }, 400)
    let frozen: string | null | undefined
    if (parsed.body.frozenRequestSnapshot != null) {
      const snap = requireShoppingCiphertext(parsed.body.frozenRequestSnapshot, "Receipt snapshot")
      if (typeof snap !== "string") return snap
      frozen = snap
    }
    const receipt = await upsertReceiptDraft({
      groupId,
      userId,
      payerMemberId,
      encryptedPayload,
      keyVersion,
      listId: typeof parsed.body.listId === "string" ? parsed.body.listId : null,
      frozenRequestSnapshot: frozen,
      receiptId: typeof parsed.body.id === "string" ? parsed.body.id : undefined,
    })
    return shoppingJson({
      id: receipt.id,
      revision: receipt.revision,
      status: receipt.status,
      updatedAt: receipt.updatedAt.toISOString(),
    }, 201)
  })
}
