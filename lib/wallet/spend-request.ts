import { sha256 } from "@noble/hashes/sha2.js"
import { z } from "zod"
import { bytesToHex, hexToBytes } from "@/lib/wallet/public-data-tools"

/**
 * The spend request is the unit a user approves with their passkey and the
 * unit the co-signer signs. Both sides recompute {@link spendRequestDigest}
 * independently from the request body; the passkey grant stores that digest,
 * so a grant can never be replayed against a different transaction.
 *
 * Pure TypeScript: no WASM, no I/O. Shared by browser and server.
 */

export const SPEND_REQUEST_DOMAIN = "BitBudget/spend-request/v1"
/** Keeps a worst-case commit body (tx + spent outputs + tweaks + commitments) under the 32 KiB wallet API body limit. */
export const MAX_SPEND_INPUTS = 40

const hexBytes = z.string().min(2).max(65_536).regex(/^(?:[0-9a-f]{2})+$/)
const hash32 = z.string().regex(/^[0-9a-f]{64}$/)

export const spendRequestSchema = z.object({
  lineage: z.enum(["sha256d", "blake2b"]),
  unsignedTxHex: hexBytes,
  spentOutputsHex: hexBytes,
  /** Per-input Taproot tweak (HMAC merkle root) so the co-signer can derive the same child key. */
  inputs: z.array(z.object({ merkleRootHex: hash32 }).strict()).min(1).max(MAX_SPEND_INPUTS),
}).strict()
export type SpendRequest = z.infer<typeof spendRequestSchema>

export const spendCommitSchema = spendRequestSchema.extend({
  grantId: z.string().uuid(),
  /** Device (participant 1) FROST commitments, one per input, in input order. */
  aCommitmentsHex: z.array(hexBytes.max(4096)).min(1).max(MAX_SPEND_INPUTS),
}).strict()
export type SpendCommit = z.infer<typeof spendCommitSchema>

export const spendCommitResponseSchema = z.object({
  walletId: z.string().uuid(),
  lineage: z.enum(["sha256d", "blake2b"]),
  digest: hash32,
  inputs: z.array(z.object({ bCommitmentHex: hexBytes.max(4096), bSignatureHex: hexBytes.max(256) }).strict()).min(1).max(MAX_SPEND_INPUTS),
}).strict()
export type SpendCommitResponse = z.infer<typeof spendCommitResponseSchema>

function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes))
}

/**
 * Domain-separated digest over the account, wallet, network, lineage, the
 * unsigned transaction, the spent outputs and every per-input tweak.
 */
export function spendRequestDigest(userId: string, walletId: string, network: string, request: SpendRequest): string {
  // Accept a commit body too: only the request fields participate in the digest.
  const parsed = spendRequestSchema.parse({
    lineage: request.lineage, unsignedTxHex: request.unsignedTxHex, spentOutputsHex: request.spentOutputsHex, inputs: request.inputs,
  })
  if (!userId || !walletId || !network) throw new Error("Spend request binding is incomplete")
  const payload = JSON.stringify([
    SPEND_REQUEST_DOMAIN,
    userId,
    walletId,
    network,
    parsed.lineage,
    sha256Hex(hexToBytes(parsed.unsignedTxHex)),
    sha256Hex(hexToBytes(parsed.spentOutputsHex)),
    parsed.inputs.map((input) => input.merkleRootHex),
  ])
  return sha256Hex(new TextEncoder().encode(payload))
}

/** Hash the device commitments for the single-use nonce record. */
export function commitmentsHashInput(aCommitmentsHex: readonly string[]): Uint8Array {
  const parts = aCommitmentsHex.map((hex) => hexToBytes(hex))
  const total = parts.reduce((s, p) => s + p.length + 4, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    new DataView(out.buffer).setUint32(offset, p.length, false)
    offset += 4
    out.set(p, offset)
    offset += p.length
  }
  return out
}
