import { withShoppingUser } from "@/lib/shopping-api"
import { readShoppingJson, requirePositiveInt, shoppingJson } from "@/lib/shopping-http"
import { applyShoppingPostings, skipShoppingPosting, type ShoppingPostingEntryInput } from "@/lib/shopping-posting-server"
import { SHOPPING_ENTRY_KINDS, type ShoppingEntryKind } from "@/lib/shopping-types"

export async function POST(req: Request, ctx: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await ctx.params
  return withShoppingUser(async (userId) => {
    const parsed = await readShoppingJson(req)
    if (!parsed.ok) return parsed.response
    if (parsed.body.action === "skip") {
      const eventId = parsed.body.eventId
      const entryKey = parsed.body.entryKey
      const preferenceVersion = requirePositiveInt(parsed.body.preferenceVersion)
      if (typeof eventId !== "string" || typeof entryKey !== "string" || preferenceVersion == null) {
        return shoppingJson({ error: "Missing skip fields" }, 400)
      }
      await skipShoppingPosting({ userId, groupId, eventId, entryKey, preferenceVersion })
      return shoppingJson({ skipped: true })
    }
    const eventId = parsed.body.eventId
    const preferenceVersion = requirePositiveInt(parsed.body.preferenceVersion)
    const projectionRevision = requirePositiveInt(parsed.body.projectionRevision)
    if (typeof eventId !== "string" || preferenceVersion == null || projectionRevision == null) {
      return shoppingJson({ error: "Missing posting fields" }, 400)
    }
    if (!Array.isArray(parsed.body.entries)) {
      return shoppingJson({ error: "Missing entries" }, 400)
    }
    const entries: ShoppingPostingEntryInput[] = []
    for (const raw of parsed.body.entries) {
      if (!raw || typeof raw !== "object") return shoppingJson({ error: "Invalid entry" }, 400)
      const row = raw as Record<string, unknown>
      if (typeof row.entryKey !== "string" || typeof row.kind !== "string") {
        return shoppingJson({ error: "Invalid entry" }, 400)
      }
      if (!(SHOPPING_ENTRY_KINDS as readonly string[]).includes(row.kind)) {
        return shoppingJson({ error: "Unknown shopping entry type" }, 400)
      }
      if (typeof row.cents !== "number" || typeof row.postedOn !== "string" || typeof row.payee !== "string") {
        return shoppingJson({ error: "Invalid entry" }, 400)
      }
      if (row.type !== "expense" && row.type !== "credit") {
        return shoppingJson({ error: "type must be expense or credit" }, 400)
      }
      if (typeof row.envelopeId !== "string") {
        return shoppingJson({ error: "Choose an envelope" }, 400)
      }
      entries.push({
        entryKey: row.entryKey,
        kind: row.kind as ShoppingEntryKind,
        cents: row.cents,
        type: row.type,
        postedOn: row.postedOn,
        payee: row.payee,
        notes: typeof row.notes === "string" ? row.notes : null,
        envelopeId: row.envelopeId,
      })
    }
    const result = await applyShoppingPostings({
      userId,
      groupId,
      eventId,
      preferenceVersion,
      projectionRevision,
      entries,
    })
    return shoppingJson(result)
  })
}
