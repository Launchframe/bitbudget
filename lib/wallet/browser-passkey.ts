import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server"
import { z } from "zod"
import { WalletClientError, walletRequest } from "@/lib/wallet/client-http"

const PRF_INPUT = new TextEncoder().encode("BitBudget/device-share/prf/v1")
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!

function bufferLength(value: unknown): number | null {
  try { return arrayBufferByteLength.call(value) as number } catch { return null }
}
export class PasskeyEncryptionError extends WalletClientError {
  constructor(readonly reason: "browser-unavailable" | "not-supported" | "missing-output" | "invalid-output") {
    super("passkey-encryption-unavailable")
  }
}

const grantSchema = z.object({ verified: z.literal(true), grantId: z.string().uuid() })
const optionsEnvelope = z.object({ challengeId: z.string().uuid(), options: z.record(z.unknown()) })

export function decodeCredentialBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 24_000) throw new WalletClientError("invalid-credential")
  const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/"))
  return Uint8Array.from(decoded, character => character.charCodeAt(0))
}

function encode(bytes: ArrayBuffer): string {
  if (bufferLength(bytes) === null) throw new WalletClientError("invalid-credential")
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function extractPrf(credential: PublicKeyCredential): Uint8Array<ArrayBuffer> | null {
  const extensions = credential.getClientExtensionResults() as AuthenticationExtensionsClientOutputs & {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } }
  }
  if (extensions.prf?.enabled === false) throw new PasskeyEncryptionError("not-supported")
  const first = extensions.prf?.results?.first
  if (first === undefined) return null
  if (bufferLength(first) !== 32) throw new PasskeyEncryptionError("invalid-output")
  const result = new Uint8Array(first).slice()
  new Uint8Array(first).fill(0)
  return result
}

export function credentialJson(credential: PublicKeyCredential, registration: boolean) {
  if (credential.type !== "public-key" || encode(credential.rawId) !== credential.id) throw new WalletClientError("invalid-credential")
  const common = { id: credential.id, rawId: credential.id, type: "public-key" as const, clientExtensionResults: {} }
  if (registration) {
    const response = credential.response as AuthenticatorAttestationResponse
    if (bufferLength(response.attestationObject) === null) throw new WalletClientError("invalid-credential")
    return { ...common, response: { clientDataJSON: encode(response.clientDataJSON), attestationObject: encode(response.attestationObject) } }
  }
  const response = credential.response as AuthenticatorAssertionResponse
  if (bufferLength(response.signature) === null || bufferLength(response.authenticatorData) === null) throw new WalletClientError("invalid-credential")
  return { ...common, response: {
    clientDataJSON: encode(response.clientDataJSON), authenticatorData: encode(response.authenticatorData), signature: encode(response.signature),
    ...(response.userHandle ? { userHandle: encode(response.userHandle) } : {}),
  } }
}

function extensions(): AuthenticationExtensionsClientInputs {
  return { prf: { eval: { first: PRF_INPUT.slice().buffer } } } as AuthenticationExtensionsClientInputs
}

export async function walletPasskey(network: "signet" | "testnet4" | "regtest", hasCredential: boolean, signal?: AbortSignal, walletId?: string) {
  if (walletId && !hasCredential) throw new WalletClientError("credential-rejected")
  const operation = walletId ? { network, operation: "unlock", walletId } : { network, operation: "create" }
  if (typeof window === "undefined" || !window.isSecureContext || typeof PublicKeyCredential === "undefined" || !navigator.credentials?.create || !navigator.credentials?.get) {
    throw new PasskeyEncryptionError("browser-unavailable")
  }
  let prf: Uint8Array<ArrayBuffer> | null = null
  try {
    if (!hasCredential) {
      const envelope = optionsEnvelope.parse(await walletRequest("/api/wallets/credentials/registration/options", { network }, signal))
      const options = envelope.options as unknown as PublicKeyCredentialCreationOptionsJSON
      const credential = await navigator.credentials.create({ publicKey: {
        ...options, challenge: decodeCredentialBytes(options.challenge),
        user: { ...options.user, id: decodeCredentialBytes(options.user.id) },
        excludeCredentials: options.excludeCredentials?.map(item => ({ type: "public-key" as const, id: decodeCredentialBytes(item.id) })),
        authenticatorSelection: { ...options.authenticatorSelection, authenticatorAttachment: "platform", userVerification: "required", residentKey: "required" },
        extensions: extensions(),
      }, signal }) as PublicKeyCredential | null
      if (!credential) throw new WalletClientError("setup-cancelled")
      const prfEnabled = (credential.getClientExtensionResults() as { prf?: { enabled?: boolean; results?: unknown } }).prf
      if (!prfEnabled || (prfEnabled.enabled !== true && !prfEnabled.results)) throw new PasskeyEncryptionError("not-supported")
      prf = extractPrf(credential)
      const grant = grantSchema.parse(await walletRequest("/api/wallets/credentials/registration/verify", { network, challengeId: envelope.challengeId, response: credentialJson(credential, true) }, signal))
      if (prf) return { credentialId: credential.id, prfOutput: prf, grantId: grant.grantId }
    }
    const envelope = optionsEnvelope.parse(await walletRequest("/api/wallets/credentials/authentication/options", operation, signal))
    const options = envelope.options as unknown as PublicKeyCredentialRequestOptionsJSON
    const credential = await navigator.credentials.get({ publicKey: {
      ...options, challenge: decodeCredentialBytes(options.challenge), userVerification: "required",
      allowCredentials: options.allowCredentials?.map(item => ({ type: "public-key" as const, id: decodeCredentialBytes(item.id) })),
      extensions: extensions(),
    }, signal }) as PublicKeyCredential | null
    if (!credential) throw new WalletClientError("setup-cancelled")
    prf = extractPrf(credential)
    if (!prf) throw new PasskeyEncryptionError("missing-output")
    const grant = grantSchema.parse(await walletRequest("/api/wallets/credentials/authentication/verify", { ...operation, challengeId: envelope.challengeId, response: credentialJson(credential, false) }, signal))
    return { credentialId: credential.id, prfOutput: prf, grantId: grant.grantId }
  } catch (error) {
    prf?.fill(0)
    if (error instanceof WalletClientError) throw error
    if (error instanceof DOMException && ["NotAllowedError", "AbortError"].includes(error.name)) throw new WalletClientError("setup-cancelled")
    throw new WalletClientError("passkey-ceremony-failed")
  }
}
