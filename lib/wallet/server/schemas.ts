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
export const authenticationOptionsSchema = z.discriminatedUnion("operation", [createAuthentication, unlockAuthentication])
const verification = { challengeId: z.string().uuid(), response: authenticationResponseSchema }
export const authenticationVerifySchema = z.discriminatedUnion("operation", [createAuthentication.extend(verification).strict(), unlockAuthentication.extend(verification).strict()])
export const walletIdSchema = z.string().uuid()
