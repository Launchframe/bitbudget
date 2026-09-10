import { Address, OutScript, RawTx, CompactSize, TEST_NETWORK, NETWORK } from "@scure/btc-signer"
import { RawOutput } from "@scure/btc-signer/script.js"
import { bytesToHex, hexToBytes } from "@/lib/wallet/public-data-tools"
import type { BitcoinNetwork } from "@/lib/wallet/types"
import type { CustodyUtxo } from "@/lib/wallet/custody-sync"

/**
 * Pure transaction planning for the BitBudget wallet. No keys, no network, no
 * WASM: everything here is deterministic and unit-testable. Signing happens in
 * `spend-session.ts`; this module only decides *what* to sign.
 *
 * Taproot-only by product decision: every input is a P2TR key-path spend and
 * every change output is P2TR. Recipient outputs may be any standard type.
 */

/** Consensus dust threshold for a P2TR output at the default relay fee. */
export const P2TR_DUST_SATS = 330
/** Refuse to plan absurd fees: > 1 BTC or > 50% of the send amount. */
export const MAX_FEE_SATS = 100_000_000
export const MIN_FEE_RATE_SAT_VB = 1
export const MAX_FEE_RATE_SAT_VB = 2_000

// BIP341 key-path input: 41 vB non-witness + 66 WU witness (1 item, 64-byte sig + len) / 4 = 57.5 vB.
const INPUT_VBYTES = 57.5
// Version + locktime + segwit marker/flag + input/output counts (for < 253 of each).
const OVERHEAD_VBYTES = 10.5
// 8 amount + 1 len + 34 script.
const P2TR_OUTPUT_VBYTES = 43

export interface SpendInput {
  txid: string
  vout: number
  valueSats: number
  address: string
  scriptPubKeyHex: string
  branch: "receive" | "change"
  index: number
}

export interface SpendOutput {
  address: string
  scriptHex: string
  valueSats: number
  kind: "recipient" | "change"
}

export interface SpendPlan {
  inputs: SpendInput[]
  outputs: SpendOutput[]
  feeSats: number
  feeRateSatVb: number
  vbytes: number
  /** Sats going back to the wallet as change (0 when no change output). */
  changeSats: number
  /** Sats added to the fee because a change output would have been dust. */
  absorbedDustSats: number
  /** Change-branch index used for the change output, or null when there is none. */
  changeIndex: number | null
  network: BitcoinNetwork
}

export interface PlanSpendInput {
  utxos: readonly CustodyUtxo[]
  recipientAddress: string
  /** Ignored when `sendMax` is true. */
  amountSats: number
  feeRateSatVb: number
  /** Address to receive change. Must be one of this wallet's change-branch addresses. */
  changeAddress: string
  changeIndex: number
  network: BitcoinNetwork
  sendMax?: boolean
  /** Include unconfirmed coins. Default false: spending unconfirmed inputs risks a stuck send. */
  allowUnconfirmed?: boolean
}

export class SpendPlanError extends Error {
  constructor(readonly code:
    | "invalid-address"
    | "wrong-network"
    | "amount-too-small"
    | "insufficient-funds"
    | "fee-rate-out-of-range"
    | "fee-too-high"
    | "no-coins"
    | "invalid-change") {
    super(code)
    this.name = "SpendPlanError"
  }
}

export function btcNetwork(network: BitcoinNetwork) {
  switch (network) {
    case "mainnet":
      return NETWORK
    case "regtest":
      return { ...TEST_NETWORK, bech32: "bcrt" }
    case "signet":
    case "testnet":
    case "testnet4":
      return TEST_NETWORK
    default: {
      const exhaustive: never = network
      return exhaustive
    }
  }
}

/** Decode an address for `network`; throws {@link SpendPlanError} for foreign or malformed input. */
export function addressToScript(address: string, network: BitcoinNetwork): Uint8Array {
  const trimmed = address.trim()
  if (!trimmed || trimmed.length > 120) throw new SpendPlanError("invalid-address")
  let decoded
  try {
    decoded = Address(btcNetwork(network)).decode(trimmed)
  } catch {
    // Distinguish "valid elsewhere" from "garbage" so the UI can say so.
    for (const other of ["mainnet", "signet", "regtest"] as const) {
      if (other === network) continue
      try { Address(btcNetwork(other)).decode(trimmed); throw new SpendPlanError("wrong-network") } catch (e) { if (e instanceof SpendPlanError) throw e }
    }
    throw new SpendPlanError("invalid-address")
  }
  return OutScript.encode(decoded)
}

export function estimateVbytes(inputCount: number, outputCount: number, recipientScriptLen = 34): number {
  // Recipient output size varies by type; change is always P2TR.
  const recipientVbytes = 8 + 1 + recipientScriptLen
  const changeOutputs = Math.max(0, outputCount - 1)
  return Math.ceil(OVERHEAD_VBYTES + inputCount * INPUT_VBYTES + recipientVbytes + changeOutputs * P2TR_OUTPUT_VBYTES)
}

export function feeFor(inputCount: number, outputCount: number, feeRateSatVb: number, recipientScriptLen = 34): number {
  return Math.ceil(estimateVbytes(inputCount, outputCount, recipientScriptLen) * feeRateSatVb)
}

function toSpendInput(u: CustodyUtxo, network: BitcoinNetwork): SpendInput {
  return {
    txid: u.txid,
    vout: u.vout,
    valueSats: u.valueSats,
    address: u.address,
    scriptPubKeyHex: bytesToHex(addressToScript(u.address, network)),
    branch: u.chain === 0 ? "receive" : "change",
    index: u.index,
  }
}

/**
 * Coin selection. Deterministic and conservative:
 *  1. Confirmed coins first; unconfirmed only when explicitly allowed.
 *  2. Within a tier, prefer spending change coins before received coins when
 *     they cover the amount alone (spending our own change first means fewer
 *     received-coin links are revealed to the recipient), otherwise largest-first.
 *  3. If the leftover after fee would be dust, drop the change output and
 *     absorb it into the fee rather than leaving a toxic crumb.
 */
export function selectCoins(
  utxos: readonly CustodyUtxo[],
  amountSats: number,
  feeRateSatVb: number,
  recipientScriptLen: number,
  opts: { allowUnconfirmed?: boolean } = {},
): { selected: CustodyUtxo[]; feeSats: number; changeSats: number; absorbedDustSats: number } {
  const eligible = utxos.filter((u) => u.valueSats > 0 && (u.confirmed || opts.allowUnconfirmed))
  if (eligible.length === 0) throw new SpendPlanError("no-coins")
  const tiers: CustodyUtxo[][] = [
    eligible.filter((u) => u.confirmed),
    ...(opts.allowUnconfirmed ? [eligible.filter((u) => !u.confirmed)] : []),
  ]
  const byValueDesc = (a: CustodyUtxo, b: CustodyUtxo) => b.valueSats - a.valueSats
  const ordered: CustodyUtxo[] = []
  for (const tier of tiers) {
    const change = tier.filter((u) => u.chain === 1).sort(byValueDesc)
    const received = tier.filter((u) => u.chain === 0).sort(byValueDesc)
    // Try change-only first if it can cover the target on its own.
    const changeTotal = change.reduce((s, u) => s + u.valueSats, 0)
    const needWithChangeOnly = amountSats + feeFor(change.length, 2, feeRateSatVb, recipientScriptLen)
    if (change.length && changeTotal >= needWithChangeOnly) ordered.push(...change, ...received)
    else ordered.push(...[...tier].sort(byValueDesc))
  }

  const selected: CustodyUtxo[] = []
  let total = 0
  for (const u of ordered) {
    selected.push(u)
    total += u.valueSats
    const feeWithChange = feeFor(selected.length, 2, feeRateSatVb, recipientScriptLen)
    if (total >= amountSats + feeWithChange) {
      const changeSats = total - amountSats - feeWithChange
      if (changeSats >= P2TR_DUST_SATS) return { selected, feeSats: feeWithChange, changeSats, absorbedDustSats: 0 }
      const feeNoChange = feeFor(selected.length, 1, feeRateSatVb, recipientScriptLen)
      return { selected, feeSats: total - amountSats, changeSats: 0, absorbedDustSats: total - amountSats - feeNoChange }
    }
    const feeNoChange = feeFor(selected.length, 1, feeRateSatVb, recipientScriptLen)
    if (total >= amountSats + feeNoChange) {
      return { selected, feeSats: total - amountSats, changeSats: 0, absorbedDustSats: total - amountSats - feeNoChange }
    }
  }
  throw new SpendPlanError("insufficient-funds")
}

export function planSpend(input: PlanSpendInput): SpendPlan {
  const feeRate = input.feeRateSatVb
  if (!Number.isFinite(feeRate) || feeRate < MIN_FEE_RATE_SAT_VB || feeRate > MAX_FEE_RATE_SAT_VB) throw new SpendPlanError("fee-rate-out-of-range")
  const recipientScript = addressToScript(input.recipientAddress, input.network)
  const changeScript = addressToScript(input.changeAddress, input.network)
  if (changeScript.length !== 34 || changeScript[0] !== 0x51 || changeScript[1] !== 0x20) throw new SpendPlanError("invalid-change")
  if (!Number.isSafeInteger(input.changeIndex) || input.changeIndex < 0) throw new SpendPlanError("invalid-change")

  const eligible = input.utxos.filter((u) => u.valueSats > 0 && (u.confirmed || input.allowUnconfirmed))
  if (eligible.length === 0) throw new SpendPlanError("no-coins")

  let selected: CustodyUtxo[]
  let feeSats: number
  let changeSats = 0
  let absorbedDustSats = 0
  let amountSats: number

  if (input.sendMax) {
    selected = [...eligible].sort((a, b) => b.valueSats - a.valueSats)
    const total = selected.reduce((s, u) => s + u.valueSats, 0)
    feeSats = feeFor(selected.length, 1, feeRate, recipientScript.length)
    amountSats = total - feeSats
    if (amountSats < P2TR_DUST_SATS) throw new SpendPlanError("insufficient-funds")
  } else {
    amountSats = input.amountSats
    if (!Number.isSafeInteger(amountSats) || amountSats < P2TR_DUST_SATS) throw new SpendPlanError("amount-too-small")
    const pick = selectCoins(eligible, amountSats, feeRate, recipientScript.length, { allowUnconfirmed: input.allowUnconfirmed })
    selected = pick.selected
    feeSats = pick.feeSats
    changeSats = pick.changeSats
    absorbedDustSats = pick.absorbedDustSats
  }

  if (feeSats > MAX_FEE_SATS || (!input.sendMax && feeSats > amountSats / 2 && feeSats > 10_000)) throw new SpendPlanError("fee-too-high")

  const outputs: SpendOutput[] = [
    { address: input.recipientAddress.trim(), scriptHex: bytesToHex(recipientScript), valueSats: amountSats, kind: "recipient" },
  ]
  if (changeSats > 0) outputs.push({ address: input.changeAddress, scriptHex: bytesToHex(changeScript), valueSats: changeSats, kind: "change" })

  const inputs = selected.map((u) => toSpendInput(u, input.network))
  const inTotal = inputs.reduce((s, i) => s + i.valueSats, 0)
  const outTotal = outputs.reduce((s, o) => s + o.valueSats, 0)
  if (inTotal - outTotal !== feeSats) throw new SpendPlanError("fee-too-high")

  return {
    inputs,
    outputs,
    feeSats,
    feeRateSatVb: feeRate,
    vbytes: estimateVbytes(inputs.length, outputs.length, recipientScript.length),
    changeSats,
    absorbedDustSats,
    changeIndex: changeSats > 0 ? input.changeIndex : null,
    network: input.network,
  }
}

export interface UnsignedTransaction {
  /** Legacy-serialized (no witness) unsigned transaction. */
  txHex: string
  /** Bitcoin-consensus `Vec<TxOut>` of the spent outputs, in input order. */
  spentOutputsHex: string
}

/**
 * Serialize the plan as an unsigned transaction. Uses BIP68-disabled
 * sequence (0xfffffffd) so the send is RBF-signalling, version 2, locktime 0.
 */
export function buildUnsignedTransaction(plan: SpendPlan): UnsignedTransaction {
  const tx = RawTx.encode({
    version: 2,
    segwitFlag: undefined,
    inputs: plan.inputs.map((i) => ({ txid: hexToBytes(i.txid), index: i.vout, finalScriptSig: new Uint8Array(), sequence: 0xfffffffd })),
    outputs: plan.outputs.map((o) => ({ amount: BigInt(o.valueSats), script: hexToBytes(o.scriptHex) })),
    witnesses: undefined,
    lockTime: 0,
  })
  const spent = concat([
    CompactSize.encode(BigInt(plan.inputs.length)),
    ...plan.inputs.map((i) => RawOutput.encode({ amount: BigInt(i.valueSats), script: hexToBytes(i.scriptPubKeyHex) })),
  ])
  return { txHex: bytesToHex(tx), spentOutputsHex: bytesToHex(spent) }
}

/** Decode the wire transaction back to its inputs/outputs for independent verification. */
export function decodeUnsignedTransaction(txHex: string) {
  const decoded = RawTx.decode(hexToBytes(txHex))
  return {
    version: decoded.version,
    lockTime: decoded.lockTime,
    inputs: decoded.inputs.map((i) => ({ txid: bytesToHex(i.txid), vout: i.index, sequence: i.sequence, scriptSigLen: i.finalScriptSig.length })),
    outputs: decoded.outputs.map((o) => ({ valueSats: Number(o.amount), scriptHex: bytesToHex(o.script) })),
  }
}

/** Decode a consensus `Vec<TxOut>` produced by {@link buildUnsignedTransaction}. */
export function decodeSpentOutputs(spentOutputsHex: string): Array<{ valueSats: number; scriptHex: string }> {
  const bytes = hexToBytes(spentOutputsHex)
  if (bytes.length === 0) throw new Error("Empty spent outputs")
  const countSize = compactSizeLen(bytes[0]!)
  const count = Number(CompactSize.decode(bytes.subarray(0, countSize)))
  let offset = countSize
  const out: Array<{ valueSats: number; scriptHex: string }> = []
  for (let i = 0; i < count; i++) {
    const amount = new DataView(bytes.buffer, bytes.byteOffset + offset, 8)
    const value = Number(amount.getBigUint64(0, true))
    offset += 8
    const scriptLenSize = compactSizeLen(bytes[offset]!)
    const scriptLen = Number(CompactSize.decode(bytes.subarray(offset, offset + scriptLenSize)))
    offset += scriptLenSize
    out.push({ valueSats: value, scriptHex: bytesToHex(bytes.subarray(offset, offset + scriptLen)) })
    offset += scriptLen
  }
  if (offset !== bytes.length) throw new Error("Trailing bytes in spent outputs")
  return out
}

function compactSizeLen(first: number): number {
  return first < 0xfd ? 1 : first === 0xfd ? 3 : first === 0xfe ? 5 : 9
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) { out.set(p, offset); offset += p.length }
  return out
}

/** Pick a fee rate from Esplora estimates: ~3-block target, clamped, with a floor. */
export function chooseFeeRate(estimates: Record<string, number>, fallback = 2): number {
  const candidates = ["3", "2", "4", "6", "1"]
  for (const k of candidates) {
    const v = estimates[k]
    if (typeof v === "number" && Number.isFinite(v) && v >= MIN_FEE_RATE_SAT_VB) return Math.min(MAX_FEE_RATE_SAT_VB, Math.ceil(v * 10) / 10)
  }
  return fallback
}
