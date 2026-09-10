import * as core from "@/wallet-mpc/pkg/wallet_mpc.js"
import { walletRequest, WalletClientError } from "@/lib/wallet/client-http"
import { bytesToHex, hexToBytes } from "@/lib/wallet/public-data-tools"
import { unwrapDeviceShare } from "@/lib/wallet/client-custody"
import { deriveAddressTweak, deriveWalletAddress } from "@/lib/wallet/derivation"
import { openWalletWatchSeed } from "@/lib/wallet/watch-custody"
import { walletPasskey } from "@/lib/wallet/browser-passkey"
import type { StoredWalletCustody } from "@/lib/wallet/wallet-idb"
import type { EsploraClient } from "@/lib/wallets/esplora-client"
import { buildUnsignedTransaction, type SpendPlan } from "@/lib/wallet/spend-builder"
import { spendCommitResponseSchema, spendRequestDigest, type SpendRequest } from "@/lib/wallet/spend-request"
import { revalidateSpendEvidence, verifySpendEvidence, type SpendEvidence } from "@/lib/wallet/spend-evidence"

/**
 * Device (participant 1) side of a spend. See `lib/wallet/server/signing.ts`
 * for the protocol. Everything secret — PRF output, share A, the watch seed,
 * nonces — lives only inside this call and is zeroed or freed in `finally`.
 * Broadcast goes straight from the browser to the user's explorer.
 */

export type SpendStage = "preparing" | "approving" | "cosigning" | "finalizing" | "broadcasting" | "done"

export interface ExecuteSpendInput {
  userId: string
  walletId: string
  network: "signet" | "testnet4" | "regtest"
  record: StoredWalletCustody
  privacyKey: Uint8Array
  plan: SpendPlan
  lineage: "sha256d" | "blake2b"
  client: EsploraClient
  signal?: AbortSignal
  onStage?: (stage: SpendStage) => void
  /**
   * Set to false only in tests that stub the indexer; production callers
   * always re-check every input against the explorer before the passkey
   * prompt and again right before broadcast.
   */
  verifyEvidence?: boolean
}

export interface ExecuteSpendResult {
  txid: string
  rawTxHex: string
  digest: string
  evidence: SpendEvidence | null
}

const SIGHASH_DEFAULT = 0

function initializeCore() {
  const asset = new URL("../../wallet-mpc/pkg/wallet_mpc_bg.wasm", import.meta.url)
  const url = typeof location === "undefined" ? asset.href : new URL(asset.href, location.origin).href
  return core.default({ module_or_path: url })
}

function resources() {
  const live = new Set<{ free(): void }>()
  return {
    keep<T extends { free(): void }>(value: T): T { live.add(value); return value },
    consume<T extends { free(): void }, R>(value: T, action: () => R): R { live.delete(value); return action() },
    close() { for (const value of live) value.free(); live.clear() },
  }
}

export async function executeSpend(input: ExecuteSpendInput): Promise<ExecuteSpendResult> {
  const { record, plan } = input
  if (record.identity.id !== input.walletId || record.context.network !== input.network) throw new WalletClientError("wallet-response-mismatch")
  if (!record.envelopes.deviceShare) throw new WalletClientError("device-share-unavailable")
  if (!record.watchEnvelope) throw new WalletClientError("watch-seed-unavailable")
  if (plan.network !== input.network || plan.inputs.length === 0) throw new WalletClientError("invalid-spend-plan")

  const owned = resources()
  const buffers: Uint8Array[] = []
  try {
    input.onStage?.("preparing")
    // Ownership/amount/unspent evidence from the user's indexer, before anyone is asked to approve.
    let evidence: SpendEvidence | null = null
    if (input.verifyEvidence !== false) evidence = await verifySpendEvidence(plan, input.client)
    await initializeCore()
    const unsigned = buildUnsignedTransaction(plan)

    // Per-input tweaks from the sealed watch seed; verify each input really is ours.
    const seed = await openWalletWatchSeed(record.watchEnvelope, input.privacyKey, record.context)
    buffers.push(seed)
    const merkleRoots = plan.inputs.map((spend) => {
      const expected = deriveWalletAddress(seed, record.context, spend.branch, spend.index)
      if (expected.scriptPubKeyHex !== spend.scriptPubKeyHex) throw new WalletClientError("invalid-spend-plan")
      return deriveAddressTweak(seed, record.context, spend.branch, spend.index)
    })
    seed.fill(0)

    const request: SpendRequest = {
      lineage: input.lineage,
      unsignedTxHex: unsigned.txHex,
      spentOutputsHex: unsigned.spentOutputsHex,
      inputs: merkleRoots.map((root) => ({ merkleRootHex: bytesToHex(root) })),
    }
    const digest = spendRequestDigest(input.userId, input.walletId, input.network, request)

    // Passkey approval bound to this exact request.
    input.onStage?.("approving")
    const passkey = await walletPasskey(input.network, true, input.signal, input.walletId, { lineage: input.lineage, digest })
    buffers.push(passkey.prfOutput)
    if (passkey.credentialId !== record.envelopes.deviceShare.credentialId) throw new WalletClientError("credential-rejected")
    const secretA = await unwrapDeviceShare({ envelope: record.envelopes.deviceShare, expectedContext: record.envelopes.deviceShare.context, credentialId: passkey.credentialId, prfOutput: passkey.prfOutput })
    buffers.push(secretA)
    passkey.prfOutput.fill(0)

    const publicPackage = hexToBytes(record.context.publicPackageHex)
    const a = owned.keep(core.WasmWalletShare.import_secret_share(1, secretA, publicPackage))
    secretA.fill(0)
    if (bytesToHex(a.output_key()) !== record.context.groupPublicKeyHex) throw new WalletClientError("device-share-mismatch")

    const txBytes = hexToBytes(unsigned.txHex)
    const spentBytes = hexToBytes(unsigned.spentOutputsHex)
    const children = merkleRoots.map((root) => owned.keep(a.derive_child(root)))
    const childPublics = merkleRoots.map((root) => core.derive_public_package(publicPackage, root))
    const sighashes = plan.inputs.map((_, i) => core.bitcoin_keypath_sighash(txBytes, spentBytes, i, SIGHASH_DEFAULT))
    const nonces = children.map((child, i) => owned.keep(child.commit_digest_low_level(sighashes[i]!, 2)))
    const aCommitments = nonces.map((nonce) => nonce.commitment())

    input.onStage?.("cosigning")
    const response = spendCommitResponseSchema.parse(await walletRequest(`/api/wallets/${input.walletId}/sign`, {
      ...request,
      grantId: passkey.grantId,
      aCommitmentsHex: aCommitments.map((c) => bytesToHex(c)),
    }, input.signal))
    if (response.walletId !== input.walletId || response.digest !== digest || response.inputs.length !== plan.inputs.length) throw new WalletClientError("wallet-response-mismatch")

    input.onStage?.("finalizing")
    let signedTx: Uint8Array = txBytes
    for (let i = 0; i < plan.inputs.length; i++) {
      const bCommitment = hexToBytes(response.inputs[i]!.bCommitmentHex)
      const bSignature = hexToBytes(response.inputs[i]!.bSignatureHex)
      const session = owned.keep(new core.WasmSigningSession(sighashes[i]!, 1, aCommitments[i]!, 2, bCommitment))
      const nonce = nonces[i]!
      const aSignature = owned.consume(nonce, () => nonce.sign(children[i]!, session))
      const signature = session.aggregate(childPublics[i]!, 1, aSignature, 2, bSignature)
      core.verify_signature(childPublics[i]!, sighashes[i]!, signature)
      signedTx = core.finalize_bitcoin_keypath(signedTx, i, signature, SIGHASH_DEFAULT)
    }

    input.onStage?.("broadcasting")
    // If the tip moved while the user was approving, make sure the coins are still ours to spend.
    if (evidence) evidence = await revalidateSpendEvidence(evidence, input.client)
    const rawTxHex = bytesToHex(signedTx)
    const txid = await input.client.broadcastTx(rawTxHex)
    input.onStage?.("done")
    return { txid, rawTxHex, digest, evidence }
  } finally {
    for (const buffer of buffers) buffer.fill(0)
    owned.close()
  }
}
