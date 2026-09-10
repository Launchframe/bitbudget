import { createHash } from "node:crypto"
import { prisma } from "@/lib/db"
import { requireCreationConfig, testNetworkSchema, walletProfileId, WalletError } from "@/lib/wallet/server/config"
import { loadWalletMpc } from "@/lib/wallet/server/mpc"
import { unwrapCosignerShare } from "@/lib/wallet/server/encryption"
import { burnSigningGrantAndCommitment, requireGrant, type GrantBinding } from "@/lib/wallet/server/grants"
import { commitmentsHashInput, spendCommitSchema, spendRequestDigest, type SpendCommit, type SpendCommitResponse } from "@/lib/wallet/spend-request"
import { decodeSpentOutputs, decodeUnsignedTransaction } from "@/lib/wallet/spend-builder"

/**
 * Co-signer (participant 2) side of a spend.
 *
 * Protocol (one round trip, FROST two-round collapsed by ordering):
 *   1. Browser builds the unsigned tx, computes the request digest, gets a
 *      passkey grant bound to that digest, generates its nonces and sends
 *      its commitments here.
 *   2. Server verifies grant ⇄ digest, checks every spent output really is
 *      the tweaked wallet key for that input, burns the grant together with
 *      the device commitments (single use), then generates its own nonces,
 *      builds the per-input signing sessions and returns commitments plus
 *      signature shares.
 *   3. Browser rebuilds the same sessions, signs with share A, aggregates,
 *      verifies, finalizes and broadcasts. The server never sees the final
 *      transaction and never broadcasts.
 *
 * Nonces are never persisted: WasmSigningNonce is created and consumed in
 * this request. The grant + commitment record makes the request replay-proof.
 */

const SIGHASH_DEFAULT = 0

function free(items: Array<{ free(): void } | undefined>) {
  for (const item of items) item?.free()
}

export async function cosignSpend(userId: string, walletId: string, origin: string, raw: unknown): Promise<SpendCommitResponse> {
  const { origins } = requireCreationConfig()
  if (!origins.includes(origin)) throw new WalletError(403, "origin-rejected")
  const input: SpendCommit = spendCommitSchema.parse(raw)
  if (input.inputs.length !== input.aCommitmentsHex.length) throw new WalletError(400, "invalid-spend-request")

  const wallet = await prisma.walletAccount.findFirst({ where: { id: walletId, userId, status: "ready" }, include: { cosigner: true } })
  if (!wallet || !wallet.publicPackage || !wallet.cosigner || !testNetworkSchema.safeParse(wallet.network).success) throw new WalletError(404, "wallet-not-found")
  if (wallet.derivationContext === "base-output-v1") throw new WalletError(409, "wallet-derivation-unsupported")

  const digest = spendRequestDigest(userId, walletId, wallet.network, input)
  const binding: GrantBinding = { userId, walletId, operation: "sign", network: wallet.network, lineage: input.lineage, profileId: walletProfileId, digest }
  await requireGrant(input.grantId, binding)

  // Structural checks the co-signer can do without any secret.
  let tx, spent
  try {
    tx = decodeUnsignedTransaction(input.unsignedTxHex)
    spent = decodeSpentOutputs(input.spentOutputsHex)
  } catch {
    throw new WalletError(400, "invalid-spend-request")
  }
  if (tx.inputs.length !== input.inputs.length || spent.length !== input.inputs.length || tx.outputs.length === 0) throw new WalletError(400, "invalid-spend-request")
  if (tx.inputs.some((i) => i.scriptSigLen !== 0)) throw new WalletError(400, "invalid-spend-request")
  const inSum = spent.reduce((s, o) => s + o.valueSats, 0)
  const outSum = tx.outputs.reduce((s, o) => s + o.valueSats, 0)
  if (outSum > inSum) throw new WalletError(400, "invalid-spend-request")

  const core = await loadWalletMpc()
  const publicPackage = new Uint8Array(wallet.publicPackage)
  for (let i = 0; i < input.inputs.length; i++) {
    let child: Uint8Array
    try {
      child = core.derive_public_package(publicPackage, Buffer.from(input.inputs[i]!.merkleRootHex, "hex"))
    } catch {
      throw new WalletError(400, "invalid-spend-request")
    }
    const key = Buffer.from(core.public_package_output_key(child)).toString("hex")
    if (spent[i]!.scriptHex !== `5120${key}`) throw new WalletError(400, "spent-output-mismatch")
  }

  // Burn first: even if signing throws, the grant and device commitments cannot be reused.
  await burnSigningGrantAndCommitment(input.grantId, binding, commitmentsHashInput(input.aCommitmentsHex))

  const publicPackageHash = createHash("sha256").update(publicPackage).digest("hex")
  const secret = unwrapCosignerShare(new Uint8Array(wallet.cosigner.encryptedShare), { userId, walletId, network: wallet.network, publicPackageHash, purpose: "share" })
  let share
  try {
    share = core.WasmWalletShare.import_secret_share(2, secret, publicPackage)
  } finally {
    secret.fill(0)
  }
  const txBytes = Buffer.from(input.unsignedTxHex, "hex")
  const spentBytes = Buffer.from(input.spentOutputsHex, "hex")
  const results: SpendCommitResponse["inputs"] = []
  try {
    for (let i = 0; i < input.inputs.length; i++) {
      let child, nonce, session
      try {
        child = share.derive_child(Buffer.from(input.inputs[i]!.merkleRootHex, "hex"))
        const sighash = core.bitcoin_keypath_sighash(txBytes, spentBytes, i, SIGHASH_DEFAULT)
        nonce = child.commit_digest_low_level(sighash, 1)
        const bCommitment = nonce.commitment()
        session = new core.WasmSigningSession(sighash, 1, Buffer.from(input.aCommitmentsHex[i]!, "hex"), 2, bCommitment)
        const bSignature = nonce.sign(child, session)
        nonce = undefined // consumed by sign()
        results.push({ bCommitmentHex: Buffer.from(bCommitment).toString("hex"), bSignatureHex: Buffer.from(bSignature).toString("hex") })
      } catch (error) {
        if (error instanceof WalletError) throw error
        throw new WalletError(400, "cosign-failed")
      } finally {
        free([session, nonce, child])
      }
    }
  } finally {
    share.free()
  }
  return { walletId, lineage: input.lineage, digest, inputs: results }
}
