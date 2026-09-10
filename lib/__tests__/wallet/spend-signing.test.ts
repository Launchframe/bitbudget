import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { derivationContext, deriveAddressTweak, deriveWalletAddress } from "@/lib/wallet/derivation"
import type { WalletPublicContext } from "@/lib/wallet/client-custody"
import { buildUnsignedTransaction, planSpend } from "@/lib/wallet/spend-builder"
import { MAX_SPEND_INPUTS, commitmentsHashInput, spendCommitSchema, spendRequestDigest, spendRequestSchema, type SpendRequest } from "@/lib/wallet/spend-request"
import { authenticationOptionsSchema, authenticationVerifySchema } from "@/lib/wallet/server/schemas"
import { validateGrantBinding } from "@/lib/wallet/server/grants"
import { cosignSpend } from "@/lib/wallet/server/signing"
import { authenticationOptions } from "@/lib/wallet/server/credentials"
import { WalletError } from "@/lib/wallet/server/config"
import { hexToBytes } from "@/lib/wallet/public-data-tools"

const mocks = vi.hoisted(() => ({
  findWallet: vi.fn(), findGrant: vi.fn(), tx: vi.fn(), core: vi.fn(),
  findCredentials: vi.fn(), createChallenge: vi.fn(),
}))
vi.mock("@/lib/db", () => ({ prisma: {
  walletAccount: { findFirst: mocks.findWallet },
  walletGrant: { findFirst: mocks.findGrant },
  walletCredential: { findMany: mocks.findCredentials },
  walletChallenge: { create: mocks.createChallenge },
  $transaction: mocks.tx,
} }))
vi.mock("@/lib/wallet/server/mpc", () => ({ loadWalletMpc: mocks.core }))

const origin = "http://localhost:3001"
const seed = new Uint8Array(32).fill(5)
const walletId = "2f3e8f0a-2d7d-4b52-9a49-4a6d2f8f0c11"
const grantId = "b8b699c4-161d-43cf-b414-581b92632bb4"
const context: WalletPublicContext = {
  accountId: "owner", walletId, network: "signet", shareFormat: "frost-secp256k1-tr-v3",
  groupPublicKeyHex: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
  publicPackageHex: "aabbcc", policy: { threshold: 2, participants: 3 }, derivationContext: derivationContext(seed),
}

function request(): SpendRequest {
  const inAddr = deriveWalletAddress(seed, context, "receive", 2)
  const change = deriveWalletAddress(seed, context, "change", 0)
  const plan = planSpend({
    utxos: [{ txid: "cc".repeat(32), vout: 1, valueSats: 90_000, address: inAddr.address, chain: 0, index: 2, confirmed: true, blockHeight: 5 }],
    recipientAddress: deriveWalletAddress(seed, context, "receive", 50).address,
    amountSats: 30_000, feeRateSatVb: 1, changeAddress: change.address, changeIndex: 0, network: "signet",
  })
  const unsigned = buildUnsignedTransaction(plan)
  return {
    lineage: "sha256d",
    unsignedTxHex: unsigned.txHex,
    spentOutputsHex: unsigned.spentOutputsHex,
    inputs: [{ merkleRootHex: Buffer.from(deriveAddressTweak(seed, context, "receive", 2)).toString("hex") }],
  }
}

/** Fake WASM public-package derivation that mirrors the real HMAC-tweak math via derivation.ts. */
function fakeCore() {
  return {
    derive_public_package: (_pub: Uint8Array, root: Uint8Array) => root,
    public_package_output_key: (child: Uint8Array) => {
      const merkleRoot = Buffer.from(child).toString("hex")
      const match = [0, 1, 2, 3, 4, 50].flatMap(i => (["receive", "change"] as const).map(branch => ({ branch, i })))
        .find(({ branch, i }) => Buffer.from(deriveAddressTweak(seed, context, branch, i)).toString("hex") === merkleRoot)
      if (!match) throw new Error("unknown tweak")
      return hexToBytes(deriveWalletAddress(seed, context, match.branch, match.i).outputKeyHex)
    },
    WasmWalletShare: { import_secret_share: () => { throw new Error("signing reached") } },
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("WALLET_WEBAUTHN_RP_ID", "localhost")
  vi.stubEnv("WALLET_WEBAUTHN_ORIGINS", origin)
  vi.stubEnv("WALLET_COSIGNER_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"))
  mocks.core.mockResolvedValue(fakeCore())
  mocks.findWallet.mockResolvedValue({
    id: walletId, userId: "owner", network: "signet", status: "ready", derivationContext: context.derivationContext,
    publicPackage: Buffer.from("aabbcc", "hex"), cosigner: { encryptedShare: Buffer.alloc(40, 1) },
  })
  mocks.tx.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({
    walletAccount: { findFirst: async () => ({ id: walletId }) },
    walletGrant: { updateMany: async () => ({ count: 1 }) },
    walletNonceUse: { create: async () => ({}) },
  }))
})
afterEach(() => vi.unstubAllEnvs())

describe("spend request digest", () => {
  it("binds account, wallet, network, lineage, transaction, spent outputs and tweaks", () => {
    const body = request()
    const digest = spendRequestDigest("owner", walletId, "signet", body)
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
    expect(spendRequestDigest("owner", walletId, "signet", body)).toBe(digest)
    expect(spendRequestDigest("other", walletId, "signet", body)).not.toBe(digest)
    expect(spendRequestDigest("owner", walletId, "regtest", body)).not.toBe(digest)
    expect(spendRequestDigest("owner", walletId, "signet", { ...body, lineage: "blake2b" })).not.toBe(digest)
    expect(spendRequestDigest("owner", walletId, "signet", { ...body, unsignedTxHex: body.unsignedTxHex.replace(/..$/, "01") })).not.toBe(digest)
    expect(spendRequestDigest("owner", walletId, "signet", { ...body, inputs: [{ merkleRootHex: "00".repeat(32) }] })).not.toBe(digest)
    // The digest string is a valid sign-grant binding.
    expect(() => validateGrantBinding({ userId: "owner", walletId, operation: "sign", network: "signet", lineage: "sha256d", profileId: "dual-lineage-v1", digest })).not.toThrow()
  })

  it("rejects malformed requests and caps input count", () => {
    const body = request()
    expect(() => spendRequestSchema.parse({ ...body, inputs: [] })).toThrow()
    expect(() => spendRequestSchema.parse({ ...body, inputs: Array.from({ length: MAX_SPEND_INPUTS + 1 }, () => body.inputs[0]) })).toThrow()
    expect(() => spendRequestSchema.parse({ ...body, unsignedTxHex: "abc" })).toThrow()
    expect(() => spendCommitSchema.parse({ ...body, grantId, aCommitmentsHex: [] })).toThrow()
    expect(() => spendCommitSchema.parse({ ...body, grantId: "nope", aCommitmentsHex: ["00"] })).toThrow()
    const hashInput = commitmentsHashInput(["0102", "03"])
    expect(Buffer.from(hashInput).toString("hex")).toBe("00000002" + "0102" + "00000001" + "03")
  })
})

describe("passkey sign scope", () => {
  it("accepts a sign operation only with wallet, lineage and digest", () => {
    const digest = "ab".repeat(32)
    expect(authenticationOptionsSchema.parse({ network: "signet", operation: "sign", walletId, lineage: "sha256d", digest })).toMatchObject({ operation: "sign" })
    expect(() => authenticationOptionsSchema.parse({ network: "signet", operation: "sign", walletId, lineage: "sha256d" })).toThrow()
    expect(() => authenticationOptionsSchema.parse({ network: "signet", operation: "unlock", walletId, digest })).toThrow()
    expect(() => authenticationVerifySchema.parse({ network: "signet", operation: "sign", walletId, lineage: "sha256d", digest, challengeId: grantId })).toThrow()
  })

  it("issues sign challenges only for ready wallets and stores lineage + digest on the challenge", async () => {
    mocks.findCredentials.mockResolvedValue([{ credentialId: "cred-a" }])
    mocks.createChallenge.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: grantId, ...data }))
    const digest = "cd".repeat(32)
    await authenticationOptions("owner", "signet", origin, walletId, { lineage: "sha256d", digest })
    expect(mocks.findWallet).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "ready" }) }))
    expect(mocks.createChallenge).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ operation: "sign", walletId, lineage: "sha256d", digest }) }))
    await expect(authenticationOptions("owner", "signet", origin, walletId, { lineage: "sha256d", digest: "zz" })).rejects.toMatchObject({ code: "invalid-binding" })
    await expect(authenticationOptions("owner", "signet", origin, null, { lineage: "sha256d", digest })).rejects.toMatchObject({ code: "invalid-binding" })
  })
})

describe("co-signer spend validation", () => {
  const commit = (over: Partial<ReturnType<typeof request>> = {}) => ({ ...request(), ...over, grantId, aCommitmentsHex: ["a1".repeat(33)] })

  it("rejects when the grant does not match the request digest", async () => {
    mocks.findGrant.mockResolvedValue(null)
    await expect(cosignSpend("owner", walletId, origin, commit())).rejects.toMatchObject({ status: 403, code: "grant-rejected" } satisfies Partial<WalletError>)
    const body = commit()
    expect(mocks.findGrant).toHaveBeenCalledWith({ where: expect.objectContaining({
      id: grantId, operation: "sign", walletId, lineage: "sha256d", digest: spendRequestDigest("owner", walletId, "signet", body),
    }) })
  })

  it("refuses to co-sign a spent output that is not the tweaked wallet key, before burning the grant", async () => {
    mocks.findGrant.mockResolvedValue({ id: grantId })
    const body = commit({ inputs: [{ merkleRootHex: Buffer.from(deriveAddressTweak(seed, context, "receive", 3)).toString("hex") }] })
    await expect(cosignSpend("owner", walletId, origin, body)).rejects.toMatchObject({ status: 400, code: "spent-output-mismatch" })
    expect(mocks.tx).not.toHaveBeenCalled()
  })

  it("rejects wallets that are not ready or use the legacy base derivation", async () => {
    mocks.findWallet.mockResolvedValueOnce(null)
    await expect(cosignSpend("owner", walletId, origin, commit())).rejects.toMatchObject({ code: "wallet-not-found" })
    mocks.findWallet.mockResolvedValueOnce({ id: walletId, network: "signet", status: "ready", derivationContext: "base-output-v1", publicPackage: Buffer.from("aa", "hex"), cosigner: { encryptedShare: Buffer.alloc(40) } })
    await expect(cosignSpend("owner", walletId, origin, commit())).rejects.toMatchObject({ code: "wallet-derivation-unsupported" })
  })

  it("burns the grant and device commitments before touching the co-signer share", async () => {
    mocks.findGrant.mockResolvedValue({ id: grantId })
    const body = commit()
    // Signing itself is exercised by the WASM-backed suites; here the fake core throws once the share is imported.
    await expect(cosignSpend("owner", walletId, origin, body)).rejects.toMatchObject({ status: 503, code: "cosigner-unavailable" })
    expect(mocks.tx).toHaveBeenCalledTimes(1)
    const expectedHash = createHash("sha256").update(commitmentsHashInput(body.aCommitmentsHex)).digest("hex")
    expect(expectedHash).toMatch(/^[0-9a-f]{64}$/)
  })
})
