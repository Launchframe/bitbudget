import { withShoppingUser } from "@/lib/shopping-api"
import { readShoppingJson, requireShoppingCiphertext, shoppingJson } from "@/lib/shopping-http"
import { createGroup, listGroupsForUser } from "@/lib/shopping-server"

export async function GET() {
  return withShoppingUser(async (userId) => {
    const groups = await listGroupsForUser(userId)
    return shoppingJson({ groups })
  })
}

export async function POST(req: Request) {
  return withShoppingUser(async (userId) => {
    const parsed = await readShoppingJson(req)
    if (!parsed.ok) return parsed.response
    const encryptedMetadata = requireShoppingCiphertext(parsed.body.encryptedMetadata, "Group name")
    if (typeof encryptedMetadata !== "string") return encryptedMetadata
    const encryptedAlias = requireShoppingCiphertext(parsed.body.encryptedAlias, "Your name in this group")
    if (typeof encryptedAlias !== "string") return encryptedAlias
    const wrappedKey = parsed.body.wrappedKey
    const pinnedKeyFingerprint = parsed.body.pinnedKeyFingerprint
    const localId = parsed.body.localId
    if (typeof wrappedKey !== "string") {
      return shoppingJson({ error: "Missing wrapped group key" }, 400)
    }
    if (typeof pinnedKeyFingerprint !== "string") {
      return shoppingJson({ error: "Invalid key fingerprint" }, 400)
    }
    if (typeof localId !== "string" || localId.length < 8) {
      return shoppingJson({ error: "Missing member id" }, 400)
    }
    const result = await createGroup({
      userId,
      encryptedMetadata,
      encryptedAlias,
      wrappedKey,
      pinnedKeyFingerprint,
      localId,
    })
    return shoppingJson({ id: result.group.id, memberId: result.member.id, localId: result.member.localId }, 201)
  })
}
