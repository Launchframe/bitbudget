import { describe, expect, it, vi } from "vitest"
import { derivationContext, deriveWalletAddress } from "@/lib/wallet/derivation"
import type { WalletPublicContext } from "@/lib/wallet/client-custody"
import { buildUnsignedTransaction, planSpend, type SpendPlan } from "@/lib/wallet/spend-builder"
import { SpendEvidenceError, revalidateSpendEvidence, verifySpendEvidence, type EvidenceIndexer } from "@/lib/wallet/spend-evidence"

const seed = new Uint8Array(32).fill(9)
const context: WalletPublicContext = {
  accountId: "owner", walletId: "w", network: "signet", shareFormat: "frost-secp256k1-tr-v3",
  groupPublicKeyHex: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
  publicPackageHex: "aabbcc", policy: { threshold: 2, participants: 3 }, derivationContext: derivationContext(seed),
}
const funding = deriveWalletAddress(seed, context, "receive", 0)
const change = deriveWalletAddress(seed, context, "change", 0)
const recipient = deriveWalletAddress(seed, context, "receive", 9)

/** Build a "previous transaction" that pays `value` sats to the funding address at vout 1. */
function fundingTxHex(value: number): string {
  const pay = planSpend({
    utxos: [{ txid: "11".repeat(32), vout: 0, valueSats: value + 1_000, address: recipient.address, chain: 0, index: 9, confirmed: true, blockHeight: 1 }],
    recipientAddress: funding.address, amountSats: value, feeRateSatVb: 1, changeAddress: change.address, changeIndex: 0, network: "signet",
  })
  // Recipient output is emitted first, so move it to vout 1 by swapping when needed.
  const tx = buildUnsignedTransaction({ ...pay, outputs: [pay.outputs[1] ?? pay.outputs[0]!, pay.outputs[0]!] })
  return tx.txHex
}

function plan(value = 50_000): SpendPlan {
  return planSpend({
    utxos: [{ txid: "ab".repeat(32), vout: 1, valueSats: value, address: funding.address, chain: 0, index: 0, confirmed: true, blockHeight: 100 }],
    recipientAddress: recipient.address, amountSats: 20_000, feeRateSatVb: 1, changeAddress: change.address, changeIndex: 0, network: "signet",
  })
}

function indexer(over: Partial<EvidenceIndexer> = {}, opts: { tip?: number; value?: number; confirmed?: boolean; rawValue?: number } = {}): EvidenceIndexer {
  const value = opts.value ?? 50_000
  return {
    getTipHeight: vi.fn(async () => opts.tip ?? 200),
    getAddressUtxos: vi.fn(async () => [{ txid: "ab".repeat(32), vout: 1, value, status: { confirmed: opts.confirmed ?? true, block_height: 100 } }]),
    getTxHex: vi.fn(async () => fundingTxHex(opts.rawValue ?? value)),
    ...over,
  }
}

describe("verifySpendEvidence", () => {
  it("accepts inputs that are unspent, confirmed and match the raw previous transaction", async () => {
    const client = indexer()
    const evidence = await verifySpendEvidence(plan(), client, { now: () => 1_000 })
    expect(evidence).toMatchObject({ tipHeight: 200, checkedAt: 1_000 })
    expect(evidence.inputs).toEqual([{ txid: "ab".repeat(32), vout: 1, valueSats: 50_000, scriptPubKeyHex: funding.scriptPubKeyHex, address: funding.address, confirmed: true }])
    expect(client.getTxHex).toHaveBeenCalledWith("ab".repeat(32))
  })

  it("refuses spent, missing, unconfirmed or misreported coins", async () => {
    await expect(verifySpendEvidence(plan(), indexer({ getAddressUtxos: async () => [] }))).rejects.toMatchObject({ code: "input-spent" } satisfies Partial<SpendEvidenceError>)
    await expect(verifySpendEvidence(plan(), indexer({}, { value: 49_999 }))).rejects.toMatchObject({ code: "amount-mismatch" })
    await expect(verifySpendEvidence(plan(), indexer({}, { confirmed: false }))).rejects.toMatchObject({ code: "unconfirmed-input" })
    await expect(verifySpendEvidence(plan(), indexer({}, { confirmed: false }), { requireConfirmed: false })).resolves.toMatchObject({ inputs: [{ confirmed: false }] })
    // The index says 50 000 but the raw transaction pays 40 000: the raw bytes win.
    await expect(verifySpendEvidence(plan(), indexer({}, { rawValue: 40_000 }))).rejects.toMatchObject({ code: "amount-mismatch" })
    // Raw transaction pays a different script (the plan's scriptPubKey is not what vout 1 carries).
    const wrongScript = { ...plan(), inputs: [{ ...plan().inputs[0]!, scriptPubKeyHex: change.scriptPubKeyHex }] }
    await expect(verifySpendEvidence(wrongScript, indexer())).rejects.toMatchObject({ code: "script-mismatch" })
    await expect(verifySpendEvidence(plan(), indexer({ getTxHex: async () => fundingTxHex(50_000).slice(0, 20) }))).rejects.toMatchObject({ code: "indexer-unavailable" })
    await expect(verifySpendEvidence(plan(), indexer({ getTipHeight: async () => { throw new Error("offline") } }))).rejects.toMatchObject({ code: "indexer-unavailable" })
  })
})

describe("revalidateSpendEvidence", () => {
  it("is a no-op while the tip and age are unchanged, and re-checks coins once the tip moves", async () => {
    const base = await verifySpendEvidence(plan(), indexer(), { now: () => 1_000 })
    const same = indexer()
    await revalidateSpendEvidence(base, same, { now: () => 2_000 })
    expect(same.getAddressUtxos).not.toHaveBeenCalled()

    const moved = indexer({}, { tip: 201 })
    const refreshed = await revalidateSpendEvidence(base, moved, { now: () => 2_000 })
    expect(moved.getAddressUtxos).toHaveBeenCalledTimes(1)
    expect(refreshed.tipHeight).toBe(201)

    const spent = indexer({ getAddressUtxos: async () => [] }, { tip: 201 })
    await expect(revalidateSpendEvidence(base, spent)).rejects.toMatchObject({ code: "evidence-stale" })
    await expect(revalidateSpendEvidence(base, indexer({}, { tip: 199 }))).rejects.toMatchObject({ code: "evidence-stale" })
  })

  it("re-checks coins when the evidence is older than the allowed age even if the tip is unchanged", async () => {
    const base = await verifySpendEvidence(plan(), indexer(), { now: () => 0 })
    const client = indexer()
    await revalidateSpendEvidence(base, client, { now: () => 11 * 60 * 1000 })
    expect(client.getAddressUtxos).toHaveBeenCalledTimes(1)
  })
})
