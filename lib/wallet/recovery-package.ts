import { hexToUint8, uint8ToHex } from "@/lib/crypto"
import { PRIVATE_DERIVATION_PREFIX, derivationSeedHash, verifyDerivationSeed } from "@/lib/wallet/derivation"
import {
  MAX_ENCRYPTED_BYTES, assertShareBytes, custodyBytes, custodyContextMatches, custodyHex,
  exactObject, parseShareCustodyContext, type ShareCustodyContext,
} from "@/lib/wallet/client-custody"

export const RECOVERY_PBKDF2_ITERATIONS = 600_000
export const MAX_RECOVERY_FILE_CHARACTERS = 750_000

export interface RecoveryPackage {
  version: 1 | 2
  kind: "password-share"
  purpose: "required-recovery-C" | "optional-device-A-export"
  algorithm: "AES-256-GCM"
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: 600000; saltHex: string }
  context: ShareCustodyContext
  ivHex: string
  ciphertextHex: string
}

export interface DecryptedRecoveryShare {
  status: "decrypted-unverified"
  context: ShareCustodyContext
  share: Uint8Array
  derivationSeed?: Uint8Array
}

export type RecoveryShareValidator = (input: {
  share: Uint8Array
  context: ShareCustodyContext
  derivationSeed?: Uint8Array
}) => Promise<boolean>

export function parseRecoveryPackage(value: unknown): RecoveryPackage {
  if (typeof value === "string") {
    if (value.length > MAX_RECOVERY_FILE_CHARACTERS) throw new Error("Recovery file is too large")
    try {
      value = JSON.parse(value)
    } catch {
      throw new Error("Invalid recovery file")
    }
  }
  exactObject(value, ["version", "kind", "purpose", "algorithm", "kdf", "context", "ivHex", "ciphertextHex"])
  if ((value.version !== 1 && value.version !== 2) || value.kind !== "password-share" || value.algorithm !== "AES-256-GCM") {
    throw new Error("Unsupported recovery package")
  }
  const context = parseShareCustodyContext(value.context)
  if (value.version === 2) {
    if (!derivationSeedHash(context.derivationContext)) throw new Error("Recovery derivation seed is required")
  } else if (context.derivationContext.startsWith(PRIVATE_DERIVATION_PREFIX)) throw new Error("Recovery derivation seed is required")
  const purpose = context.role === "C" ? "required-recovery-C" : "optional-device-A-export"
  if (value.purpose !== purpose) throw new Error("Recovery share role mismatch")
  exactObject(value.kdf, ["name", "hash", "iterations", "saltHex"])
  if (value.kdf.name !== "PBKDF2" || value.kdf.hash !== "SHA-256" || value.kdf.iterations !== RECOVERY_PBKDF2_ITERATIONS) {
    throw new Error("Unsupported recovery KDF parameters")
  }
  custodyHex(value.kdf.saltHex, 32)
  custodyHex(value.ivHex, 12)
  custodyHex(value.ciphertextHex, 21, MAX_ENCRYPTED_BYTES)
  return {
    version: value.version, kind: "password-share", purpose, algorithm: "AES-256-GCM",
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: RECOVERY_PBKDF2_ITERATIONS, saltHex: value.kdf.saltHex },
    context, ivHex: value.ivHex, ciphertextHex: value.ciphertextHex,
  }
}

function recoveryAad(envelope: Omit<RecoveryPackage, "ciphertextHex">): Uint8Array {
  return new TextEncoder().encode(JSON.stringify([
    "bitbudget-recovery-share", envelope.version, envelope.kind, envelope.purpose,
    envelope.algorithm, envelope.kdf, envelope.context, envelope.ivHex,
  ]))
}

function validatePassword(password: string): void {
  if (typeof password !== "string" || password.length < 12 || password.length > 1024) {
    throw new Error("Recovery password must contain 12 to 1024 characters")
  }
}

async function recoveryKey(password: string, saltHex: string): Promise<CryptoKey> {
  const passwordBytes = new TextEncoder().encode(password)
  try {
    const material = await crypto.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveKey"])
    return await crypto.subtle.deriveKey({
      name: "PBKDF2", hash: "SHA-256", iterations: RECOVERY_PBKDF2_ITERATIONS,
      salt: custodyBytes(hexToUint8(saltHex)),
    }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
  } finally {
    passwordBytes.fill(0)
  }
}

function encodePayload(context: ShareCustodyContext, share: Uint8Array, seed?: Uint8Array): Uint8Array {
  const metadata = new TextEncoder().encode(JSON.stringify(context))
  const payload = new Uint8Array(4 + metadata.byteLength + share.byteLength + (seed ? 36 : 0))
  new DataView(payload.buffer).setUint32(0, metadata.byteLength)
  payload.set(metadata, 4)
  const offset = 4 + metadata.byteLength
  if (seed) {
    new DataView(payload.buffer).setUint32(offset, share.byteLength)
    payload.set(share, offset + 4)
    payload.set(seed, offset + 4 + share.byteLength)
  } else payload.set(share, offset)
  return payload
}

export async function createRecoveryPackage(input: {
  share: Uint8Array
  context: ShareCustodyContext
  password: string
  derivationSeed?: Uint8Array
}): Promise<RecoveryPackage> {
  assertShareBytes(input.share)
  validatePassword(input.password)
  const context = parseShareCustodyContext(input.context)
  if (input.derivationSeed) verifyDerivationSeed(input.derivationSeed, context.derivationContext)
  else if (context.derivationContext.startsWith(PRIVATE_DERIVATION_PREFIX)) throw new Error("Recovery derivation seed is required")
  const envelope: Omit<RecoveryPackage, "ciphertextHex"> = {
    version: input.derivationSeed ? 2 : 1, kind: "password-share",
    purpose: context.role === "C" ? "required-recovery-C" : "optional-device-A-export",
    algorithm: "AES-256-GCM",
    kdf: {
      name: "PBKDF2", hash: "SHA-256", iterations: RECOVERY_PBKDF2_ITERATIONS,
      saltHex: uint8ToHex(crypto.getRandomValues(new Uint8Array(32))),
    },
    context, ivHex: uint8ToHex(crypto.getRandomValues(new Uint8Array(12))),
  }
  const payload = encodePayload(context, input.share, input.derivationSeed)
  const plaintext = custodyBytes(payload)
  payload.fill(0)
  try {
    const key = await recoveryKey(input.password, envelope.kdf.saltHex)
    const encrypted = await crypto.subtle.encrypt({
      name: "AES-GCM", iv: custodyBytes(hexToUint8(envelope.ivHex)),
      additionalData: custodyBytes(recoveryAad(envelope)), tagLength: 128,
    }, key, plaintext)
    return { ...envelope, ciphertextHex: uint8ToHex(new Uint8Array(encrypted)) }
  } finally {
    new Uint8Array(plaintext).fill(0)
  }
}

export function serializeRecoveryPackage(envelope: RecoveryPackage): string {
  return JSON.stringify(parseRecoveryPackage(envelope))
}

export async function decryptRecoveryPackage(input: {
  envelope: unknown
  expectedContext: ShareCustodyContext
  password: string
}): Promise<DecryptedRecoveryShare> {
  const envelope = parseRecoveryPackage(input.envelope)
  custodyContextMatches(envelope.context, input.expectedContext)
  validatePassword(input.password)
  const key = await recoveryKey(input.password, envelope.kdf.saltHex)
  let plaintext: Uint8Array | undefined
  try {
    plaintext = new Uint8Array(await crypto.subtle.decrypt({
      name: "AES-GCM", iv: custodyBytes(hexToUint8(envelope.ivHex)),
      additionalData: custodyBytes(recoveryAad(envelope)), tagLength: 128,
    }, key, custodyBytes(hexToUint8(envelope.ciphertextHex))))
    if (plaintext.byteLength < 5) throw new Error("Invalid recovery payload")
    const metadataLength = new DataView(plaintext.buffer).getUint32(0)
    if (metadataLength < 1 || metadataLength >= plaintext.byteLength - 4) throw new Error("Invalid recovery payload")
    const publicMetadata = new TextDecoder("utf-8", { fatal: true }).decode(plaintext.subarray(4, 4 + metadataLength))
    const context = parseShareCustodyContext(JSON.parse(publicMetadata))
    custodyContextMatches(context, envelope.context)
    const offset = 4 + metadataLength
    let shareView = plaintext.subarray(offset)
    let seedView: Uint8Array | undefined
    if (envelope.version === 2) {
      if (plaintext.length < offset + 37) throw new Error("Invalid recovery payload")
      const shareLength = new DataView(plaintext.buffer).getUint32(offset)
      if (shareLength < 1 || plaintext.length !== offset + 4 + shareLength + 32) throw new Error("Invalid recovery payload")
      shareView = plaintext.subarray(offset + 4, offset + 4 + shareLength)
      seedView = plaintext.subarray(offset + 4 + shareLength)
      verifyDerivationSeed(seedView, context.derivationContext)
    }
    assertShareBytes(shareView)
    return { status: "decrypted-unverified", context, share: shareView.slice(), ...(seedView ? { derivationSeed: seedView.slice() } : {}) }
  } catch {
    throw new Error("Unable to decrypt recovery share")
  } finally {
    plaintext?.fill(0)
  }
}

export async function verifyRecoveryPackage(input: {
  envelope: unknown
  expectedContext: ShareCustodyContext
  password: string
  validateShare: RecoveryShareValidator
}): Promise<{ status: "verified"; context: ShareCustodyContext }> {
  if (typeof input.validateShare !== "function") throw new Error("Core share validation is required")
  const decrypted = await decryptRecoveryPackage(input)
  const context = parseShareCustodyContext(decrypted.context)
  try {
    if (await input.validateShare({ share: decrypted.share, context: decrypted.context, derivationSeed: decrypted.derivationSeed }) !== true) {
      throw new Error("Core share validation failed")
    }
    return { status: "verified", context }
  } catch {
    throw new Error("Core share validation failed")
  } finally {
    decrypted.share.fill(0)
    decrypted.derivationSeed?.fill(0)
  }
}
