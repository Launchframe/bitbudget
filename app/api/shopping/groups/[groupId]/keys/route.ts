import { withShoppingUser } from "@/lib/shopping-api"
import { readShoppingJson, requireShoppingCiphertext, shoppingJson } from "@/lib/shopping-http"
import { rotateGroupKeys } from "@/lib/shopping-server"

export async function POST(req: Request, ctx: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await ctx.params
  return withShoppingUser(async (userId) => {
    const parsed = await readShoppingJson(req)
    if (!parsed.ok) return parsed.response
    const encryptedMetadata = requireShoppingCiphertext(parsed.body.encryptedMetadata, "Group name")
    if (typeof encryptedMetadata !== "string") return encryptedMetadata
    const nextKeyVersion = parsed.body.nextKeyVersion
    const wraps = parsed.body.wraps
    if (typeof nextKeyVersion !== "number" || !Number.isInteger(nextKeyVersion)) {
      return shoppingJson({ error: "Invalid key version" }, 400)
    }
    if (!Array.isArray(wraps)) {
      return shoppingJson({ error: "Missing key wraps" }, 400)
    }
    let normalized: Array<{ memberId: string; fingerprint: string; wrappedKey: string }>
    try {
      normalized = wraps.map((row) => {
        if (!row || typeof row !== "object") throw new Error("bad wrap")
        const w = row as Record<string, unknown>
        if (typeof w.memberId !== "string" || typeof w.fingerprint !== "string" || typeof w.wrappedKey !== "string") {
          throw new Error("bad wrap")
        }
        return { memberId: w.memberId, fingerprint: w.fingerprint, wrappedKey: w.wrappedKey }
      })
    } catch {
      return shoppingJson({ error: "Invalid key wraps" }, 400)
    }
    const reencrypted = (parsed.body.reencrypted && typeof parsed.body.reencrypted === "object"
      ? parsed.body.reencrypted
      : {}) as {
      lists?: Array<{ id: string; encryptedPayload: string; revision: number }>
      requests?: Array<{ id: string; encryptedPayload: string; revision: number }>
      receipts?: Array<{ id: string; encryptedPayload: string; revision: number }>
    }
    await rotateGroupKeys({
      groupId,
      userId,
      nextKeyVersion,
      encryptedMetadata,
      wraps: normalized,
      reencrypted,
    })
    return shoppingJson({ rotated: true, keyVersion: nextKeyVersion })
  })
}
