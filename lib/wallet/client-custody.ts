import { hexToUint8, uint8ToHex } from "@/lib/crypto"
import { isBitcoinNetwork, type BitcoinNetwork } from "@/lib/wallet/types"

export const MAX_SHARE_BYTES = 65_536
export const MAX_ENCRYPTED_BYTES = 262_144

export interface WalletPublicContext {
  accountId: string
  walletId: string
  network: BitcoinNetwork
  shareFormat: string
  groupPublicKeyHex: string
  publicPackageHex: string
  policy: { threshold: 2; participants: 3 }
  derivationContext: string
}

export interface ShareCustodyContext extends WalletPublicContext {
  participantId: string
  role: "A" | "C"
}

export interface DeviceShareEnvelope {
  version: 1
  kind: "device-share"
  algorithm: "AES-256-GCM"
  kdf: "HKDF-SHA-256"
  context: ShareCustodyContext
  credentialId: string
  saltHex: string
  ivHex: string
  ciphertextHex: string
}

export function exactObject(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error("Invalid custody object")
  }
}

export function custodyText(value: unknown, max = 256): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Invalid custody context")
  }
}

export function custodyHex(value: unknown, minBytes: number, maxBytes = minBytes): asserts value is string {
  if (typeof value !== "string" || value.length < minBytes * 2 || value.length > maxBytes * 2 ||
      value.length % 2 !== 0 || !/^[0-9a-f]+$/.test(value)) throw new Error("Invalid custody encoding")
}

const PUBLIC_CONTEXT_KEYS = ["accountId", "walletId", "network", "shareFormat", "groupPublicKeyHex", "publicPackageHex", "policy", "derivationContext"]

function publicContextFields(value: Record<string, unknown>): WalletPublicContext {
  custodyText(value.accountId)
  custodyText(value.walletId)
  custodyText(value.shareFormat, 128)
  custodyText(value.derivationContext, 4096)
  if (!isBitcoinNetwork(value.network)) throw new Error("Invalid custody network")
  custodyHex(value.groupPublicKeyHex, 32, 33)
  if (value.groupPublicKeyHex.length === 66 && !/^(02|03)/.test(value.groupPublicKeyHex)) throw new Error("Invalid group public key")
  custodyHex(value.publicPackageHex, 1, 65_536)
  exactObject(value.policy, ["threshold", "participants"])
  if (value.policy.threshold !== 2 || value.policy.participants !== 3) throw new Error("Unsupported custody policy")
  return {
    accountId: value.accountId,
    walletId: value.walletId,
    network: value.network,
    shareFormat: value.shareFormat,
    groupPublicKeyHex: value.groupPublicKeyHex,
    publicPackageHex: value.publicPackageHex,
    policy: { threshold: 2, participants: 3 },
    derivationContext: value.derivationContext,
  }
}

export function parseWalletPublicContext(value: unknown): WalletPublicContext {
  exactObject(value, PUBLIC_CONTEXT_KEYS)
  return publicContextFields(value)
}

export function parseShareCustodyContext(value: unknown): ShareCustodyContext {
  exactObject(value, [...PUBLIC_CONTEXT_KEYS, "participantId", "role"])
  custodyText(value.participantId)
  if (value.role !== "A" && value.role !== "C") throw new Error("Invalid share role")
  return { ...publicContextFields(value), participantId: value.participantId, role: value.role }
}

export function walletPublicContext(context: ShareCustodyContext): WalletPublicContext {
  const parsed = parseShareCustodyContext(context)
  return publicContextFields({ ...parsed })
}

export function custodyBytes(bytes: Uint8Array): ArrayBuffer {
  const result = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(result).set(bytes)
  return result
}

export function assertShareBytes(share: Uint8Array): void {
  if (!(share instanceof Uint8Array) || share.byteLength < 1 || share.byteLength > MAX_SHARE_BYTES) {
    throw new Error("Invalid serialized share size")
  }
}

export function custodyContextMatches(actual: ShareCustodyContext, expected: ShareCustodyContext): void {
  if (JSON.stringify(parseShareCustodyContext(actual)) !== JSON.stringify(parseShareCustodyContext(expected))) {
    throw new Error("Share custody context mismatch")
  }
}

export function parseDeviceShareEnvelope(value: unknown): DeviceShareEnvelope {
  exactObject(value, ["version", "kind", "algorithm", "kdf", "context", "credentialId", "saltHex", "ivHex", "ciphertextHex"])
  if (value.version !== 1 || value.kind !== "device-share" || value.algorithm !== "AES-256-GCM" || value.kdf !== "HKDF-SHA-256") {
    throw new Error("Unsupported device envelope")
  }
  const context = parseShareCustodyContext(value.context)
  if (context.role !== "A") throw new Error("Device custody requires share A")
  custodyText(value.credentialId, 2048)
  custodyHex(value.saltHex, 32)
  custodyHex(value.ivHex, 12)
  custodyHex(value.ciphertextHex, 17, MAX_SHARE_BYTES + 16)
  return {
    version: 1, kind: "device-share", algorithm: "AES-256-GCM", kdf: "HKDF-SHA-256",
    context, credentialId: value.credentialId, saltHex: value.saltHex, ivHex: value.ivHex, ciphertextHex: value.ciphertextHex,
  }
}

function deviceAad(envelope: Omit<DeviceShareEnvelope, "ciphertextHex">): Uint8Array {
  return new TextEncoder().encode(JSON.stringify([
    "bitbudget-device-share", envelope.version, envelope.kind, envelope.algorithm, envelope.kdf,
    envelope.context, envelope.credentialId, envelope.saltHex, envelope.ivHex,
  ]))
}

async function deviceKey(prfOutput: Uint8Array, envelope: Omit<DeviceShareEnvelope, "ciphertextHex">): Promise<CryptoKey> {
  if (!(prfOutput instanceof Uint8Array) || prfOutput.byteLength !== 32) throw new Error("A 32-byte authenticator PRF result is required")
  const input = custodyBytes(prfOutput)
  try {
    const material = await crypto.subtle.importKey("raw", input, "HKDF", false, ["deriveKey"])
    return await crypto.subtle.deriveKey({
      name: "HKDF", hash: "SHA-256", salt: custodyBytes(hexToUint8(envelope.saltHex)),
      info: custodyBytes(deviceAad(envelope)),
    }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
  } finally {
    new Uint8Array(input).fill(0)
  }
}

export async function wrapDeviceShare(input: {
  share: Uint8Array
  context: ShareCustodyContext
  credentialId: string
  prfOutput: Uint8Array
}): Promise<DeviceShareEnvelope> {
  assertShareBytes(input.share)
  const context = parseShareCustodyContext(input.context)
  if (context.role !== "A") throw new Error("Device custody requires share A")
  custodyText(input.credentialId, 2048)
  const envelope: Omit<DeviceShareEnvelope, "ciphertextHex"> = {
    version: 1, kind: "device-share", algorithm: "AES-256-GCM", kdf: "HKDF-SHA-256",
    context, credentialId: input.credentialId,
    saltHex: uint8ToHex(crypto.getRandomValues(new Uint8Array(32))),
    ivHex: uint8ToHex(crypto.getRandomValues(new Uint8Array(12))),
  }
  const plaintext = custodyBytes(input.share)
  try {
    const key = await deviceKey(input.prfOutput, envelope)
    const encrypted = await crypto.subtle.encrypt({
      name: "AES-GCM", iv: custodyBytes(hexToUint8(envelope.ivHex)),
      additionalData: custodyBytes(deviceAad(envelope)), tagLength: 128,
    }, key, plaintext)
    return { ...envelope, ciphertextHex: uint8ToHex(new Uint8Array(encrypted)) }
  } finally {
    new Uint8Array(plaintext).fill(0)
  }
}

export async function unwrapDeviceShare(input: {
  envelope: unknown
  expectedContext: ShareCustodyContext
  credentialId: string
  prfOutput: Uint8Array
}): Promise<Uint8Array> {
  const envelope = parseDeviceShareEnvelope(input.envelope)
  custodyContextMatches(envelope.context, input.expectedContext)
  if (envelope.credentialId !== input.credentialId) throw new Error("Credential mismatch")
  const key = await deviceKey(input.prfOutput, envelope)
  try {
    const plaintext = await crypto.subtle.decrypt({
      name: "AES-GCM", iv: custodyBytes(hexToUint8(envelope.ivHex)),
      additionalData: custodyBytes(deviceAad(envelope)), tagLength: 128,
    }, key, custodyBytes(hexToUint8(envelope.ciphertextHex)))
    return new Uint8Array(plaintext)
  } catch {
    throw new Error("Unable to unlock device share")
  }
}
