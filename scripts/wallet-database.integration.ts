import { createHash, generateKeyPairSync, randomBytes } from "node:crypto"
import { spawnSync } from "node:child_process"
import { isoCBOR } from "@simplewebauthn/server/helpers"
import { afterAll, beforeAll, expect, it } from "vitest"
import { prisma } from "@/lib/db"
import { registrationOptions, registrationVerify } from "@/lib/wallet/server/credentials"
import { loadWalletMpc } from "@/lib/wallet/server/mpc"
import { startProvisioning, finishProvisioning } from "@/lib/wallet/server/provisioning"
import { listWallets, walletStatus } from "@/lib/wallet/server/wallets"
import { recoveryOptions, recoveryVerify } from "@/lib/wallet/server/recovery"
import { createRecoveryPackage, decryptRecoveryPackage, serializeRecoveryPackage } from "@/lib/wallet/recovery-package"
import type { ShareCustodyContext } from "@/lib/wallet/client-custody"

const origin = "https://wallet.example.test"
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex")
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url")
let userId: string

beforeAll(async () => {
  const url = process.env.WALLET_TEST_DATABASE_URL
  if (!url || url !== process.env.DATABASE_URL || !/^[a-f0-9]{16}$/.test(process.env.WALLET_DATABASE_FIXTURE ?? "")) throw new Error("Use scripts/test-wallet-database.mjs to create an isolated test database")
  const parsed = new URL(url)
  if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/wallet_test") throw new Error("Refusing a non-fixture database")
  const user = await prisma.user.create({ data: { email: `wallet-${process.env.WALLET_DATABASE_FIXTURE}@bitbudget.test`, opportunityCostEnabled: true } })
  userId = user.id
})
afterAll(async () => { await prisma.$disconnect() })

async function createGrant() {
  const options = await registrationOptions(userId, "regtest", origin)
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "jwk" })
  const cose = isoCBOR.encode(new Map<number, number | Uint8Array>([
    [1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(key.x!, "base64url"))], [-3, new Uint8Array(Buffer.from(key.y!, "base64url"))],
  ]))
  const id = randomBytes(32)
  const size = Buffer.alloc(2)
  size.writeUInt16BE(id.length)
  const authData = Buffer.concat([createHash("sha256").update("wallet.example.test").digest(), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), size, id, cose])
  const attestation = isoCBOR.encode(new Map<string, string | Uint8Array | Map<string, never>>([
    ["fmt", "none"], ["attStmt", new Map<string, never>()], ["authData", new Uint8Array(authData)],
  ]))
  return registrationVerify(userId, "regtest", origin, options.challengeId, {
    id: b64(id), rawId: b64(id), type: "public-key", clientExtensionResults: {},
    response: {
      clientDataJSON: b64(Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: options.options.challenge, origin, crossOrigin: false }))),
      attestationObject: b64(attestation), transports: ["internal"],
    },
  })
}

it("persists verified registration, idempotent real DKG and one co-signer under concurrent completion", async () => {
  const grant = await createGrant()
  const credential = await prisma.walletCredential.findFirstOrThrow({ where: { userId } })
  expect(credential.publicKey.length).toBeGreaterThan(32)
  const core = await loadWalletMpc()
  const a = new core.WasmDkgRound1(1)
  const c = new core.WasmDkgRound1(3)
  const aBroadcast = a.broadcast()
  const cBroadcast = c.broadcast()
  const input = { network: "regtest" as const, grantId: grant.grantId, aBroadcastHex: hex(aBroadcast), cBroadcastHex: hex(cBroadcast) }
  const started = await Promise.allSettled([startProvisioning(userId, input), startProvisioning(userId, input)])
  const successful = started.filter(result => result.status === "fulfilled")
  expect(successful.length).toBeGreaterThan(0)
  expect(await prisma.walletAccount.count({ where: { userId } })).toBe(1)
  const response = await startProvisioning(userId, input)
  for (const result of successful) if (result.status === "fulfilled") expect(result.value.walletId).toBe(response.walletId)
  expect((await prisma.walletGrant.findUniqueOrThrow({ where: { id: grant.grantId } })).consumedAt).not.toBeNull()
  await expect(startProvisioning("other-user", input)).rejects.toThrow("grant-rejected")
  await expect(walletStatus("other-user", response.walletId)).rejects.toThrow("wallet-not-found")

  const broadcast = Buffer.from(response.bBroadcastHex, "hex")
  const a2 = a.advance(2, broadcast, 3, cBroadcast)
  const c2 = c.advance(1, aBroadcast, 2, broadcast)
  const aToB = a2.take_message(2)
  const cToB = c2.take_message(2)
  const aToC = a2.take_message(3)
  const cToA = c2.take_message(1)
  const aShare = a2.finish(2, Buffer.from(response.bToAHex, "hex"), 3, cToA)
  const cShare = c2.finish(1, aToC, 2, Buffer.from(response.bToCHex, "hex"))
  const completion = { aToBHex: hex(aToB), cToBHex: hex(cToB), publicPackageHex: hex(aShare.public_package()), transcriptHash: response.transcriptHash }
  const finished = await Promise.allSettled([finishProvisioning(userId, response.walletId, completion), finishProvisioning(userId, response.walletId, completion)])
  expect(finished.some(result => result.status === "fulfilled")).toBe(true)
  expect(await finishProvisioning(userId, response.walletId, completion)).toEqual({ walletId: response.walletId, status: "recovery-required", signingAvailable: false })
  const record = await prisma.walletAccount.findUniqueOrThrow({ where: { id: response.walletId }, include: { cosigner: true, provisioning: true } })
  expect(record.status).toBe("recovery-required")
  expect(Buffer.from(record.outputKey!)).toEqual(Buffer.from(aShare.output_key()))
  expect(record.provisioning?.encryptedState).toBeNull()
  expect(record.cosigner?.encryptedShare.length).toBeGreaterThan(29)
  expect(await prisma.walletCosigner.count({ where: { walletId: response.walletId } })).toBe(1)
  expect((await listWallets(userId)).wallets[0].lineages).toEqual(["sha256d", "blake2b"])
  expect((await listWallets(userId)).wallets[0].signingAvailable).toBe(false)
  expect(await prisma.transaction.count({ where: { userId } })).toBe(0)
  const context: ShareCustodyContext = { accountId: userId, walletId: record.id, network: "regtest", participantId: "3", role: "C", shareFormat: "frost-secp256k1-tr-v3", groupPublicKeyHex: hex(aShare.output_key()), publicPackageHex: hex(aShare.public_package()), policy: { threshold: 2, participants: 3 }, derivationContext: "base-output-v1" }
  const secretC = cShare.export_secret_share()
  const encryptedBackup = await createRecoveryPackage({ share: secretC, context, password: "synthetic fixture recovery password" })
  secretC.fill(0)
  const file = serializeRecoveryPackage(encryptedBackup)
  const restored = await decryptRecoveryPackage({ envelope: file, expectedContext: context, password: "synthetic fixture recovery password" })
  const restoredC = core.WasmWalletShare.import_secret_share(3, restored.share, aShare.public_package())
  restored.share.fill(0)
  const options = await recoveryOptions(userId, record.id, origin, { backupHash: createHash("sha256").update(file).digest("hex") })
  const digest = Buffer.from(options.digest, "hex")
  const an = aShare.commit_digest_low_level(digest, 3), cn = restoredC.commit_digest_low_level(digest, 1)
  const ac = an.commitment(), cc = cn.commitment()
  const session = new core.WasmSigningSession(digest, 1, ac, 3, cc)
  const proof = { challengeId: options.challengeId, aCommitmentHex: hex(ac), cCommitmentHex: hex(cc), aSignatureHex: hex(an.sign(aShare, session)), cSignatureHex: hex(cn.sign(restoredC, session)) }
  await expect(recoveryVerify(userId, record.id, origin, { ...proof, cSignatureHex: "00".repeat(32) })).rejects.toThrow("recovery-proof-rejected")
  expect((await walletStatus(userId, record.id)).wallet.status).toBe("recovery-required")
  const verified = await recoveryVerify(userId, record.id, origin, proof)
  expect(verified.status).toBe("ready")
  expect(verified.signingAvailable).toBe(false)
  await expect(recoveryVerify(userId, record.id, origin, proof)).rejects.toThrow("challenge-rejected")
  expect((await walletStatus(userId, record.id)).wallet.recoveryVerifiedAt).not.toBeNull()
  restoredC.free(); session.free()
  aShare.free(); cShare.free(); aToB.fill(0); cToB.fill(0); aToC.fill(0); cToA.fill(0)
  const beforeRepeat = await prisma.walletAccount.findUniqueOrThrow({ where: { id: record.id }, include: { cosigner: true, provisioning: true } })
  const repeated = spawnSync("pnpm", ["exec", "prisma", "db", "execute", "--file", "prisma/migrations/20260906230000_wallet_custody/migration.sql", "--schema", "prisma/schema.prisma"], { env: process.env, encoding: "utf8", stdio: "pipe" })
  expect(repeated.status).toBe(0)
  expect(await prisma.walletAccount.findUniqueOrThrow({ where: { id: record.id }, include: { cosigner: true, provisioning: true } })).toEqual(beforeRepeat)
})
