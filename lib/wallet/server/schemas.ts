import { z } from "zod"
import { testNetworkSchema } from "@/lib/wallet/server/config"

const base64url = z.string().min(1).max(24000).regex(/^[A-Za-z0-9_-]+$/)
const credentialId = base64url.max(1400)
const extensions = z.object({
  credProps: z.object({ rk: z.boolean().optional() }).strict().optional(),
  prf: z.object({ enabled: z.boolean().optional() }).strict().optional(),
}).strict()
const commonResponse = {
  id: credentialId,
  rawId: credentialId,
  type: z.literal("public-key"),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  clientExtensionResults: extensions,
}

export const registrationResponseSchema = z.object({
  ...commonResponse,
  response: z.object({
    clientDataJSON: base64url,
    attestationObject: base64url,
    transports: z.array(z.enum(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"])).max(7).optional(),
    publicKeyAlgorithm: z.number().int().optional(),
    publicKey: base64url.optional(),
    authenticatorData: base64url.optional(),
  }).strict(),
}).strict().refine(value => value.id === value.rawId)

export const authenticationResponseSchema = z.object({
  ...commonResponse,
  response: z.object({
    clientDataJSON: base64url,
    authenticatorData: base64url,
    signature: base64url,
    userHandle: base64url.nullable().optional().transform(value => value ?? undefined),
  }).strict(),
}).strict().refine(value => value.id === value.rawId)

export const registrationOptionsSchema = z.object({ network: testNetworkSchema }).strict()
export const registrationVerifySchema = z.object({
  network: testNetworkSchema,
  challengeId: z.string().uuid(),
  response: registrationResponseSchema,
}).strict()
const createAuthentication = z.object({ network: testNetworkSchema, operation: z.literal("create") }).strict()
const unlockAuthentication = z.object({ network: testNetworkSchema, operation: z.literal("unlock"), walletId: z.string().uuid() }).strict()
/**
 * A signing grant is bound to one spend request digest and one lineage. The
 * digest covers the unsigned transaction, spent outputs and per-input tweaks
 * (see `lib/wallet/spend-request.ts`), so the passkey approval the user gives
 * authorizes exactly that transaction and nothing else.
 */
const signAuthentication = z.object({
  network: testNetworkSchema, operation: z.literal("sign"), walletId: z.string().uuid(),
  lineage: z.enum(["sha256d", "blake2b"]), digest: z.string().regex(/^[0-9a-f]{64}$/),
}).strict()
export const authenticationOptionsSchema = z.discriminatedUnion("operation", [createAuthentication, unlockAuthentication, signAuthentication])
const verification = { challengeId: z.string().uuid(), response: authenticationResponseSchema }
export const authenticationVerifySchema = z.discriminatedUnion("operation", [
  createAuthentication.extend(verification).strict(),
  unlockAuthentication.extend(verification).strict(),
  signAuthentication.extend(verification).strict(),
])
export type AuthenticationOperation = z.infer<typeof authenticationOptionsSchema>
export const walletIdSchema = z.string().uuid()
