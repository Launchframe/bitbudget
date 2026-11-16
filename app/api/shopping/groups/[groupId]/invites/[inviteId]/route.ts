import { withShoppingUser } from "@/lib/shopping-api"
import { isShoppingKeyFingerprint } from "@/lib/shopping-crypto"
import { readShoppingJson, requireShoppingCiphertext, shoppingJson } from "@/lib/shopping-http"
import { approveInvite, rejectInvite, revokeInvite } from "@/lib/shopping-server"
import { isRequestVerificationCode } from "@/lib/shopping-invites"

export async function POST(req: Request, ctx: { params: Promise<{ groupId: string; inviteId: string }> }) {
  const { groupId, inviteId } = await ctx.params
  return withShoppingUser(async (userId) => {
    const parsed = await readShoppingJson(req)
    if (!parsed.ok) return parsed.response
    const action = parsed.body.action
    if (action === "reject") {
      await rejectInvite({ groupId, userId, inviteId })
      return shoppingJson({ rejected: true })
    }
    if (action === "revoke") {
      await revokeInvite({ groupId, userId, inviteId })
      return shoppingJson({ revoked: true })
    }
    if (action !== "approve") {
      return shoppingJson({ error: "Unknown action" }, 400)
    }
    const encryptedAlias = requireShoppingCiphertext(parsed.body.encryptedAlias, "Name")
    if (typeof encryptedAlias !== "string") return encryptedAlias
    const expectedFingerprint = parsed.body.expectedFingerprint
    const wrappedKey = parsed.body.wrappedKey
    const localId = parsed.body.localId
    const memberKeyVersion = parsed.body.memberKeyVersion
    if (typeof expectedFingerprint !== "string" || !isShoppingKeyFingerprint(expectedFingerprint)) {
      return shoppingJson({ error: "Compare the key fingerprint before approving" }, 400)
    }
    if (typeof wrappedKey !== "string") {
      return shoppingJson({ error: "Missing wrapped group key" }, 400)
    }
    if (typeof localId !== "string") {
      return shoppingJson({ error: "Missing member id" }, 400)
    }
    if (typeof memberKeyVersion !== "number" || !Number.isInteger(memberKeyVersion) || memberKeyVersion < 1) {
      return shoppingJson({ error: "Invalid key version" }, 400)
    }
    void isRequestVerificationCode
    const result = await approveInvite({
      groupId,
      userId,
      inviteId,
      expectedFingerprint,
      wrappedKey,
      encryptedAlias,
      localId,
      memberKeyVersion,
    })
    return shoppingJson(result)
  })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ groupId: string; inviteId: string }> }) {
  const { groupId, inviteId } = await ctx.params
  return withShoppingUser(async (userId) => {
    await revokeInvite({ groupId, userId, inviteId })
    return shoppingJson({ revoked: true })
  })
}
