import { Transaction } from "@scure/btc-signer"
import type { SpendPlan } from "@/lib/wallet/spend-builder"
import { bytesToHex, hexToBytes } from "@/lib/wallet/public-data-tools"

/**
 * Pre-signing evidence about the coins a spend plan intends to consume.
 *
 * The plan was built from a cached UTXO set; before a passkey is asked to
 * approve anything, every input is re-checked against the user's configured
 * indexer:
 *
 *   1. the outpoint is still unspent for its address (address UTXO listing);
 *   2. the raw previous transaction, decoded locally, really pays that
 *      amount to that scriptPubKey at that vout (so a stale or wrong index
 *      entry cannot inflate an input);
 *   3. confirmation state matches what the planner assumed.
 *
 * The chain tip is recorded so the same evidence can be revalidated just
 * before broadcast; if the tip moved, the unspent check runs again. Missing,
 * stale or inconsistent evidence refuses the spend — it never degrades to a
 * warning.
 *
 * This is ownership/amount/ancestry evidence on a single lineage. Lineage
 * isolation evidence (`evaluateTransactionIsolation`) is a separate concern
 * and still needs a Blake2b-side indexer; nothing here claims to prove it.
 */

export type SpendEvidenceCode =
  | "indexer-unavailable"
  | "input-spent"
  | "input-missing"
  | "amount-mismatch"
  | "script-mismatch"
  | "unconfirmed-input"
  | "evidence-stale"

export class SpendEvidenceError extends Error {
  constructor(readonly code: SpendEvidenceCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = "SpendEvidenceError"
  }
}

export interface SpendEvidenceInput {
  txid: string
  vout: number
  valueSats: number
  scriptPubKeyHex: string
  address: string
  confirmed: boolean
}

export interface SpendEvidence {
  /** Tip height observed when the evidence was gathered. */
  tipHeight: number
  checkedAt: number
  inputs: readonly SpendEvidenceInput[]
}

export interface EvidenceIndexer {
  getTipHeight(): Promise<number>
  getAddressUtxos(address: string): Promise<{ txid: string; vout: number; value: number; status: { confirmed: boolean; block_height?: number } }[]>
  getTxHex(txid: string): Promise<string>
}

export interface VerifySpendEvidenceOptions {
  /** Refuse unconfirmed inputs (default true; the planner only spends confirmed coins unless told otherwise). */
  requireConfirmed?: boolean
  /** Maximum age of evidence accepted by {@link revalidateSpendEvidence} (default 10 minutes). */
  maxAgeMs?: number
  now?: () => number
}

async function indexer<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof SpendEvidenceError) throw err
    throw new SpendEvidenceError("indexer-unavailable", err instanceof Error ? err.message : undefined)
  }
}

function decodeOutput(rawHex: string, vout: number): { valueSats: number; scriptHex: string } {
  let tx: Transaction
  try {
    tx = Transaction.fromRaw(hexToBytes(rawHex), { allowUnknownOutputs: true, allowUnknownInputs: true, disableScriptCheck: true })
  } catch (err) {
    throw new SpendEvidenceError("indexer-unavailable", `undecodable transaction${err instanceof Error ? `: ${err.message}` : ""}`)
  }
  if (vout >= tx.outputsLength) throw new SpendEvidenceError("input-missing", `vout ${vout} does not exist`)
  const out = tx.getOutput(vout)
  if (!out.script || out.amount === undefined) throw new SpendEvidenceError("input-missing", "output has no script")
  if (out.amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new SpendEvidenceError("amount-mismatch", "output amount exceeds safe integer")
  return { valueSats: Number(out.amount), scriptHex: bytesToHex(out.script) }
}

/** Gather and check evidence for every input of `plan`. Throws {@link SpendEvidenceError}; never returns partial evidence. */
export async function verifySpendEvidence(plan: SpendPlan, client: EvidenceIndexer, options: VerifySpendEvidenceOptions = {}): Promise<SpendEvidence> {
  const requireConfirmed = options.requireConfirmed ?? true
  const now = options.now ?? Date.now
  if (!plan.inputs.length) throw new SpendEvidenceError("input-missing", "plan has no inputs")

  const tipHeight = await indexer(() => client.getTipHeight())
  if (!Number.isSafeInteger(tipHeight) || tipHeight < 0) throw new SpendEvidenceError("indexer-unavailable", "invalid tip height")

  const byAddress = new Map<string, Awaited<ReturnType<EvidenceIndexer["getAddressUtxos"]>>>()
  const inputs: SpendEvidenceInput[] = []
  for (const input of plan.inputs) {
    let utxos = byAddress.get(input.address)
    if (!utxos) {
      utxos = await indexer(() => client.getAddressUtxos(input.address))
      byAddress.set(input.address, utxos)
    }
    const live = utxos.find((u) => u.txid === input.txid && u.vout === input.vout)
    if (!live) throw new SpendEvidenceError("input-spent", `${input.txid}:${input.vout}`)
    if (live.value !== input.valueSats) throw new SpendEvidenceError("amount-mismatch", `${input.txid}:${input.vout}`)
    if (requireConfirmed && !live.status.confirmed) throw new SpendEvidenceError("unconfirmed-input", `${input.txid}:${input.vout}`)

    const rawHex = await indexer(() => client.getTxHex(input.txid))
    const decoded = decodeOutput(rawHex, input.vout)
    if (decoded.valueSats !== input.valueSats) throw new SpendEvidenceError("amount-mismatch", `${input.txid}:${input.vout} (raw tx)`)
    if (decoded.scriptHex !== input.scriptPubKeyHex.toLowerCase()) throw new SpendEvidenceError("script-mismatch", `${input.txid}:${input.vout}`)

    inputs.push({ txid: input.txid, vout: input.vout, valueSats: input.valueSats, scriptPubKeyHex: decoded.scriptHex, address: input.address, confirmed: live.status.confirmed })
  }
  return { tipHeight, checkedAt: now(), inputs }
}

/**
 * Cheap re-check right before broadcast. If the tip moved or the evidence is
 * older than `maxAgeMs`, every input must still be unspent; otherwise the
 * spend is refused with `evidence-stale`. Returns refreshed evidence.
 */
export async function revalidateSpendEvidence(evidence: SpendEvidence, client: EvidenceIndexer, options: VerifySpendEvidenceOptions = {}): Promise<SpendEvidence> {
  const now = options.now ?? Date.now
  const maxAgeMs = options.maxAgeMs ?? 10 * 60 * 1000
  const tipHeight = await indexer(() => client.getTipHeight())
  if (!Number.isSafeInteger(tipHeight) || tipHeight < evidence.tipHeight) throw new SpendEvidenceError("evidence-stale", "tip went backwards")
  const aged = now() - evidence.checkedAt > maxAgeMs
  if (tipHeight === evidence.tipHeight && !aged) return { ...evidence, tipHeight, checkedAt: now() }

  const seen = new Map<string, Awaited<ReturnType<EvidenceIndexer["getAddressUtxos"]>>>()
  for (const input of evidence.inputs) {
    let utxos = seen.get(input.address)
    if (!utxos) {
      utxos = await indexer(() => client.getAddressUtxos(input.address))
      seen.set(input.address, utxos)
    }
    const live = utxos.find((u) => u.txid === input.txid && u.vout === input.vout)
    if (!live || live.value !== input.valueSats) throw new SpendEvidenceError("evidence-stale", `${input.txid}:${input.vout} no longer spendable`)
  }
  return { ...evidence, tipHeight, checkedAt: now() }
}
