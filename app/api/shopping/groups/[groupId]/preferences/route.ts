import { withShoppingUser } from "@/lib/shopping-api"
import { readShoppingJson, requirePositiveInt, shoppingJson } from "@/lib/shopping-http"
import { getOrCreatePreference, updatePreference } from "@/lib/shopping-server"

export async function GET(_req: Request, ctx: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await ctx.params
  return withShoppingUser(async (userId) => {
    const pref = await getOrCreatePreference(groupId, userId)
    return shoppingJson({
      enabled: pref.enabled,
      enabledAtSequence: pref.enabledAtSequence,
      catchUpApproved: pref.catchUpApproved,
      envelopeId: pref.envelopeId,
      preferenceVersion: pref.preferenceVersion,
    })
  })
}

export async function PUT(req: Request, ctx: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await ctx.params
  return withShoppingUser(async (userId) => {
    const parsed = await readShoppingJson(req)
    if (!parsed.ok) return parsed.response
    const expectedVersion = requirePositiveInt(parsed.body.expectedVersion)
    if (expectedVersion == null || expectedVersion < 1) {
      return shoppingJson({ error: "Invalid settings version" }, 400)
    }
    const pref = await updatePreference({
      groupId,
      userId,
      expectedVersion,
      enabled: parsed.body.enabled === true,
      envelopeId: typeof parsed.body.envelopeId === "string" ? parsed.body.envelopeId : null,
      catchUpApproved: parsed.body.catchUpApproved === true,
    })
    return shoppingJson({
      enabled: pref.enabled,
      enabledAtSequence: pref.enabledAtSequence,
      catchUpApproved: pref.catchUpApproved,
      envelopeId: pref.envelopeId,
      preferenceVersion: pref.preferenceVersion,
    })
  })
}
