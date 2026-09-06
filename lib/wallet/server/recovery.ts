import { createHash, randomBytes } from "node:crypto"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { requireCreationConfig, testNetworkSchema, walletProfileId, challengeLifetimeMs, WalletError } from "@/lib/wallet/server/config"
import { loadWalletMpc } from "@/lib/wallet/server/mpc"

const hashHex = z.string().regex(/^[0-9a-f]{64}$/)
const packageHex = z.string().min(2).max(4096).regex(/^(?:[0-9a-f]{2})+$/)
export const recoveryOptionsSchema = z.object({ backupHash: hashHex }).strict()
export const recoveryVerifySchema = z.object({
  challengeId: z.string().uuid(),
  aCommitmentHex: packageHex,
  cCommitmentHex: packageHex,
  aSignatureHex: packageHex,
  cSignatureHex: packageHex,
}).strict()

async function recoveryWallet(userId: string, walletId: string) {
  const wallet = await prisma.walletAccount.findFirst({ where: { id: walletId, userId } })
  if (!wallet || !wallet.publicPackage || !wallet.outputKey || !testNetworkSchema.safeParse(wallet.network).success) throw new WalletError(404, "wallet-not-found")
  if (!["recovery-required", "ready"].includes(wallet.status)) throw new WalletError(409, "wallet-not-created")
  return wallet
}

export async function recoveryOptions(userId: string, walletId: string, origin: string, input: z.infer<typeof recoveryOptionsSchema>) {
  const { rpId, origins } = requireCreationConfig()
  if (!origins.includes(origin)) throw new WalletError(403, "origin-rejected")
  const { backupHash } = recoveryOptionsSchema.parse(input)
  const wallet = await recoveryWallet(userId, walletId)
  const nonce = randomBytes(32).toString("base64url")
  const digest = createHash("sha256").update(JSON.stringify([
    "BitBudget/verified-recovery/v1", userId, walletId, wallet.network, walletProfileId,
    createHash("sha256").update(wallet.publicPackage!).digest("hex"), backupHash, nonce,
  ])).digest("hex")
  const challenge = await prisma.walletChallenge.create({ data: {
    userId, walletId, network: wallet.network, operation: "verify-recovery", profileId: walletProfileId,
    origin, rpId, digest, payloadHash: backupHash, challenge: nonce, expiresAt: new Date(Date.now() + challengeLifetimeMs),
  }, select: { id: true, expiresAt: true } })
  return { challengeId: challenge.id, digest, nonce, expiresAt: challenge.expiresAt }
}

export async function recoveryVerify(userId: string, walletId: string, origin: string, raw: z.infer<typeof recoveryVerifySchema>) {
  const { rpId, origins } = requireCreationConfig()
  if (!origins.includes(origin)) throw new WalletError(403, "origin-rejected")
  const input = recoveryVerifySchema.parse(raw)
  const wallet = await recoveryWallet(userId, walletId)
  const scope = {
    id: input.challengeId, userId, walletId, network: wallet.network, operation: "verify-recovery", profileId: walletProfileId,
    origin, rpId, consumedAt: null, expiresAt: { gt: new Date() },
  }
  const challenge = await prisma.walletChallenge.findFirst({ where: scope })
  if (!challenge?.digest || !hashHex.safeParse(challenge.digest).success || !challenge.payloadHash) throw new WalletError(403, "challenge-rejected")
  const core = await loadWalletMpc()
  let session
  try {
    session = new core.WasmSigningSession(Buffer.from(challenge.digest, "hex"), 1, Buffer.from(input.aCommitmentHex, "hex"), 3, Buffer.from(input.cCommitmentHex, "hex"))
    const signature = session.aggregate(wallet.publicPackage!, 1, Buffer.from(input.aSignatureHex, "hex"), 3, Buffer.from(input.cSignatureHex, "hex"))
    core.verify_signature(wallet.publicPackage!, Buffer.from(challenge.digest, "hex"), signature)
  } catch {
    throw new WalletError(403, "recovery-proof-rejected")
  } finally {
    session?.free()
  }
  const verifiedAt = new Date()
  await prisma.$transaction(async tx => {
    const claimed = await tx.walletChallenge.updateMany({ where: { ...scope, expiresAt: { gt: verifiedAt } }, data: { consumedAt: verifiedAt } })
    if (claimed.count !== 1) throw new WalletError(403, "challenge-rejected")
    const updated = await tx.walletAccount.updateMany({
      where: { id: walletId, userId, network: wallet.network, status: { in: ["recovery-required", "ready"] }, publicPackage: wallet.publicPackage },
      data: { status: "ready", recoveryVerifiedAt: verifiedAt, recoveryFileHash: challenge.payloadHash },
    })
    if (updated.count !== 1) throw new WalletError(409, "wallet-state-changed")
  })
  return { walletId, status: "ready", recoveryVerifiedAt: verifiedAt, signingAvailable: false }
}
