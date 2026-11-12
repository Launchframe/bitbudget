import { bytesToHex, hexToBytes } from "@/lib/wallet/public-data-tools"

export interface CreationDraftBinding { accountId: string; walletId: string; credentialId: string; network: string }
export interface SealedCreationDraft { version: 1; saltHex: string; ivHex: string; ciphertextHex: string }

function aad(binding: CreationDraftBinding): Uint8Array<ArrayBuffer> {
  if (!binding.accountId || !binding.walletId || !binding.credentialId || !["signet", "testnet4", "regtest"].includes(binding.network)) throw new Error("Invalid creation draft binding")
  return new TextEncoder().encode(JSON.stringify(["BitBudget/pending-creation/v1", binding.accountId, binding.walletId, binding.credentialId, binding.network]))
}

async function key(prf: Uint8Array, salt: Uint8Array<ArrayBuffer>, binding: CreationDraftBinding) {
  if (prf.length !== 32) throw new Error("Passkey encryption is required")
  const copy = Uint8Array.from(prf)
  try {
    const material = await crypto.subtle.importKey("raw", copy, "HKDF", false, ["deriveKey"])
    return await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: aad(binding) }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
  } finally { copy.fill(0) }
}

export function parseCreationDraft(value: unknown): SealedCreationDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid creation draft")
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join(",") !== "ciphertextHex,ivHex,saltHex,version" || record.version !== 1 ||
    typeof record.saltHex !== "string" || !/^[0-9a-f]{64}$/.test(record.saltHex) || typeof record.ivHex !== "string" || !/^[0-9a-f]{24}$/.test(record.ivHex) ||
    typeof record.ciphertextHex !== "string" || record.ciphertextHex.length > 65536 || !/^(?:[0-9a-f]{2}){17,}$/.test(record.ciphertextHex)) throw new Error("Invalid creation draft")
  return { version: 1, saltHex: record.saltHex, ivHex: record.ivHex, ciphertextHex: record.ciphertextHex }
}

export async function sealCreationDraft(value: unknown, prf: Uint8Array, binding: CreationDraftBinding): Promise<SealedCreationDraft> {
  const plain = new TextEncoder().encode(JSON.stringify(value))
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  try {
    if (!plain.length || plain.length > 32752) throw new Error("Creation draft is too large")
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(binding) }, await key(prf, salt, binding), plain)
    return { version: 1, saltHex: bytesToHex(salt), ivHex: bytesToHex(iv), ciphertextHex: bytesToHex(new Uint8Array(ciphertext)) }
  } finally { plain.fill(0) }
}

export async function openCreationDraft(value: unknown, prf: Uint8Array, binding: CreationDraftBinding): Promise<unknown> {
  const envelope = parseCreationDraft(value)
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: hexToBytes(envelope.ivHex), additionalData: aad(binding) }, await key(prf, hexToBytes(envelope.saltHex), binding), hexToBytes(envelope.ciphertextHex)))
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain)) } finally { plain.fill(0) }
}
