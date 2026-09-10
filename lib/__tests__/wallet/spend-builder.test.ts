import { describe, expect, it } from "vitest"
import { derivationContext, deriveWalletAddress } from "@/lib/wallet/derivation"
import type { WalletPublicContext } from "@/lib/wallet/client-custody"
import type { CustodyUtxo } from "@/lib/wallet/custody-sync"
import {
  P2TR_DUST_SATS,
  SpendPlanError,
  addressToScript,
  buildUnsignedTransaction,
  chooseFeeRate,
  decodeSpentOutputs,
  decodeUnsignedTransaction,
  estimateVbytes,
  feeFor,
  planSpend,
  selectCoins,
} from "@/lib/wallet/spend-builder"

const seed = new Uint8Array(32).fill(3)
const context: WalletPublicContext = {
  accountId: "a", walletId: "w", network: "signet", shareFormat: "frost-secp256k1-tr-v3",
  groupPublicKeyHex: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
  publicPackageHex: "aabbcc", policy: { threshold: 2, participants: 3 }, derivationContext: derivationContext(seed),
}
const addr = (branch: "receive" | "change", index: number) => deriveWalletAddress(seed, context, branch, index)
const RECIPIENT = addr("receive", 99).address // any valid tb1p address works as a recipient
const CHANGE = addr("change", 0)
const TXID = "aa".repeat(32)

function utxo(over: Partial<CustodyUtxo> & { valueSats: number }): CustodyUtxo {
  const chain = over.chain ?? 0
  const index = over.index ?? 0
  return {
    txid: over.txid ?? TXID, vout: over.vout ?? 0, valueSats: over.valueSats,
    address: over.address ?? addr(chain === 0 ? "receive" : "change", index).address,
    chain, index, confirmed: over.confirmed ?? true, blockHeight: over.blockHeight ?? 100,
  }
}

describe("fee estimation", () => {
  it("sizes P2TR key-path spends", () => {
    expect(estimateVbytes(1, 1)).toBe(Math.ceil(10.5 + 57.5 + 43))
    expect(estimateVbytes(2, 2)).toBe(Math.ceil(10.5 + 115 + 43 + 43))
    expect(feeFor(1, 2, 2)).toBe(Math.ceil(estimateVbytes(1, 2) * 2))
  })

  it("picks a ~3 block target from explorer estimates with a floor", () => {
    expect(chooseFeeRate({ "1": 12.4, "3": 5.04, "6": 2 })).toBe(5.1)
    expect(chooseFeeRate({})).toBe(2)
    expect(chooseFeeRate({ "3": 0.2 }, 1)).toBe(1)
  })
})

describe("addressToScript", () => {
  it("accepts same-network Taproot addresses and rejects foreign or malformed ones", () => {
    const script = addressToScript(RECIPIENT, "signet")
    expect(script.length).toBe(34)
    expect(script[0]).toBe(0x51)
    expect(() => addressToScript("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", "signet")).toThrow(new SpendPlanError("wrong-network"))
    expect(() => addressToScript("nonsense", "signet")).toThrow(new SpendPlanError("invalid-address"))
    expect(() => addressToScript(RECIPIENT, "mainnet")).toThrow(new SpendPlanError("wrong-network"))
  })
})

describe("selectCoins", () => {
  it("prefers confirmed coins and produces change above dust", () => {
    const coins = [utxo({ valueSats: 50_000, confirmed: false, index: 1 }), utxo({ valueSats: 40_000, index: 2 }), utxo({ valueSats: 5_000, index: 3 })]
    const pick = selectCoins(coins, 20_000, 2, 34)
    expect(pick.selected.map((u) => u.valueSats)).toEqual([40_000])
    expect(pick.changeSats).toBe(40_000 - 20_000 - pick.feeSats)
    expect(pick.changeSats).toBeGreaterThanOrEqual(P2TR_DUST_SATS)
    expect(pick.absorbedDustSats).toBe(0)
  })

  it("absorbs would-be dust change into the fee instead of creating a crumb", () => {
    const fee2out = feeFor(1, 2, 1, 34)
    const coins = [utxo({ valueSats: 10_000 + fee2out + 100 })]
    const pick = selectCoins(coins, 10_000, 1, 34)
    expect(pick.changeSats).toBe(0)
    expect(pick.feeSats).toBe(fee2out + 100)
    expect(pick.absorbedDustSats).toBe(fee2out + 100 - feeFor(1, 1, 1, 34))
  })

  it("spends own change coins first when they cover the send", () => {
    const coins = [utxo({ valueSats: 30_000, chain: 0, index: 0 }), utxo({ valueSats: 25_000, chain: 1, index: 0 })]
    const pick = selectCoins(coins, 10_000, 1, 34)
    expect(pick.selected[0]!.chain).toBe(1)
    expect(pick.selected.length).toBe(1)
  })

  it("rejects when funds are insufficient or no coins are eligible", () => {
    expect(() => selectCoins([utxo({ valueSats: 1_000 })], 5_000, 1, 34)).toThrow(new SpendPlanError("insufficient-funds"))
    expect(() => selectCoins([utxo({ valueSats: 1_000, confirmed: false })], 500, 1, 34)).toThrow(new SpendPlanError("no-coins"))
    expect(selectCoins([utxo({ valueSats: 100_000, confirmed: false })], 500, 1, 34, { allowUnconfirmed: true }).selected.length).toBe(1)
  })
})

describe("planSpend + buildUnsignedTransaction", () => {
  const base = { recipientAddress: RECIPIENT, feeRateSatVb: 2, changeAddress: CHANGE.address, changeIndex: 0, network: "signet" as const }

  it("builds a balanced plan whose wire encoding round-trips", () => {
    const plan = planSpend({ ...base, utxos: [utxo({ valueSats: 100_000, index: 4 })], amountSats: 40_000 })
    expect(plan.outputs.map((o) => o.kind)).toEqual(["recipient", "change"])
    const inSum = plan.inputs.reduce((s, i) => s + i.valueSats, 0)
    const outSum = plan.outputs.reduce((s, o) => s + o.valueSats, 0)
    expect(inSum - outSum).toBe(plan.feeSats)
    expect(plan.inputs[0]!.branch).toBe("receive")
    expect(plan.inputs[0]!.index).toBe(4)
    expect(plan.inputs[0]!.scriptPubKeyHex).toBe(addr("receive", 4).scriptPubKeyHex)

    const unsigned = buildUnsignedTransaction(plan)
    const decoded = decodeUnsignedTransaction(unsigned.txHex)
    expect(decoded.version).toBe(2)
    expect(decoded.lockTime).toBe(0)
    expect(decoded.inputs).toEqual([{ txid: TXID, vout: 0, sequence: 0xfffffffd, scriptSigLen: 0 }])
    expect(decoded.outputs[0]).toEqual({ valueSats: 40_000, scriptHex: plan.outputs[0]!.scriptHex })
    expect(decoded.outputs[1]!.valueSats).toBe(plan.changeSats)
    expect(decoded.outputs[1]!.scriptHex).toBe(CHANGE.scriptPubKeyHex)
    expect(decodeSpentOutputs(unsigned.spentOutputsHex)).toEqual([{ valueSats: 100_000, scriptHex: addr("receive", 4).scriptPubKeyHex }])
  })

  it("send max drains every eligible coin into one output", () => {
    const plan = planSpend({ ...base, utxos: [utxo({ valueSats: 60_000, index: 1 }), utxo({ valueSats: 20_000, index: 2, txid: "bb".repeat(32) })], amountSats: 0, sendMax: true })
    expect(plan.inputs.length).toBe(2)
    expect(plan.outputs.length).toBe(1)
    expect(plan.outputs[0]!.valueSats).toBe(80_000 - plan.feeSats)
    expect(plan.changeSats).toBe(0)
  })

  it("rejects bad amounts, fee rates, change addresses and absurd fees", () => {
    const coins = [utxo({ valueSats: 100_000 })]
    expect(() => planSpend({ ...base, utxos: coins, amountSats: 100 })).toThrow(new SpendPlanError("amount-too-small"))
    expect(() => planSpend({ ...base, utxos: coins, amountSats: 10_000, feeRateSatVb: 0 })).toThrow(new SpendPlanError("fee-rate-out-of-range"))
    expect(() => planSpend({ ...base, utxos: coins, amountSats: 10_000, feeRateSatVb: 5_000 })).toThrow(new SpendPlanError("fee-rate-out-of-range"))
    expect(() => planSpend({ ...base, utxos: coins, amountSats: 10_000, changeAddress: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu" })).toThrow(new SpendPlanError("wrong-network"))
    // 1900 sat/vB on a 20k sat send is > 50% and > 10k sats.
    expect(() => planSpend({ ...base, utxos: [utxo({ valueSats: 100_000_000 })], amountSats: 20_000, feeRateSatVb: 1_900 })).toThrow(new SpendPlanError("fee-too-high"))
  })
})
