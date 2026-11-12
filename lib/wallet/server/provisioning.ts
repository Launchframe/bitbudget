import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { requireCreationConfig, walletProfileId, testNetworkSchema, WalletError } from "@/lib/wallet/server/config"
import type { WalletTestNetwork } from "@/lib/wallet/server/config"
import { requireGrant, consumeGrant } from "@/lib/wallet/server/grants"
import { beginCosignerDkg, finishCosignerDkg } from "@/lib/wallet/server/dkg"
import { unwrapCosignerShare, wrapCosignerShare } from "@/lib/wallet/server/encryption"

const contributionHex = z.string().min(2).max(4096).regex(/^(?:[0-9a-f]{2})+$/)
const hashHex = z.string().length(64).regex(/^[0-9a-f]+$/)
export const startProvisioningSchema = z.object({
  network: testNetworkSchema,
  grantId: z.string().uuid(),
  aBroadcastHex: contributionHex,
  cBroadcastHex: contributionHex,
}).strict()
export const finishProvisioningSchema = z.object({
  aToBHex: contributionHex,
  cToBHex: contributionHex,
  publicPackageHex: z.string().min(2).max(16384).regex(/^(?:[0-9a-f]{2})+$/),
  transcriptHash: hashHex,
  derivationContext: z.string().regex(/^(?:base-output-v1|taptweak-hmac-sha256-v1:[0-9a-f]{64})$/).optional(),
}).strict()

const responseSchema = z.object({
  walletId: z.string().uuid(),
  status: z.literal("round2"),
  bBroadcastHex: contributionHex,
  bToAHex: contributionHex,
  bToCHex: contributionHex,
  transcriptHash: hashHex,
}).strict()

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")

export async function startProvisioning(userId: string, input: z.infer<typeof startProvisioningSchema>) {
  requireCreationConfig()
  const { network, grantId, aBroadcastHex, cBroadcastHex } = startProvisioningSchema.parse(input)
  const requestHash = hash([walletProfileId, network, aBroadcastHex, cBroadcastHex])
  const previous = await prisma.walletProvisioning.findFirst({ where: { grantId, wallet: { userId, network } }, include: { wallet: true } })
  if (previous) {
    if (previous.requestHash !== requestHash) throw new WalletError(409, "dkg-request-changed")
    if (previous.status !== "round2" || previous.expiresAt.getTime() <= Date.now()) throw new WalletError(409, "dkg-session-unavailable")
    const plaintext = unwrapCosignerShare(previous.encryptedResponse, {
      userId, walletId: previous.walletId, network, publicPackageHash: previous.transcriptHash, purpose: "dkg-response",
    })
    try {
      const response = responseSchema.parse(JSON.parse(plaintext.toString("utf8")))
      if (response.walletId !== previous.walletId || response.transcriptHash !== previous.transcriptHash) throw new WalletError(409, "dkg-state-mismatch")
      return response
    } finally {
      plaintext.fill(0)
    }
  }
  const grantBinding = { userId, network, walletId: null, operation: "create" as const, lineage: null, profileId: walletProfileId, digest: null }
  await requireGrant(grantId, grantBinding)
  const walletId = randomUUID()
  const binding = { userId, walletId, network }
  const begin = await beginCosignerDkg(binding, Buffer.from(aBroadcastHex, "hex"), Buffer.from(cBroadcastHex, "hex"))
  const response = responseSchema.parse({
    walletId, status: "round2", transcriptHash: begin.transcriptHash,
    bBroadcastHex: Buffer.from(begin.broadcast).toString("hex"),
    bToAHex: Buffer.from(begin.toA).toString("hex"),
    bToCHex: Buffer.from(begin.toC).toString("hex"),
  })
  const plaintext = Buffer.from(JSON.stringify(response))
  try {
    const encryptedResponse = wrapCosignerShare(plaintext, { ...binding, publicPackageHash: begin.transcriptHash, purpose: "dkg-response" })
    await prisma.$transaction(async tx => {
      await consumeGrant(tx, grantId, grantBinding)
      await tx.walletAccount.create({ data: { id: walletId, userId, network, status: "provisioning" } })
      await tx.walletProvisioning.create({ data: {
        walletId, grantId, requestHash, transcriptHash: begin.transcriptHash, encryptedState: begin.encryptedState,
        encryptedResponse, status: "round2", expiresAt: new Date(Date.now() + 10 * 60_000),
      } })
    })
    return response
  } finally {
    plaintext.fill(0)
    begin.toA.fill(0)
    begin.toC.fill(0)
  }
}

export async function finishProvisioning(userId: string, walletId: string, rawInput: z.infer<typeof finishProvisioningSchema>) {
  requireCreationConfig()
  const input = finishProvisioningSchema.parse(rawInput)
  const session = await prisma.walletProvisioning.findFirst({ where: { walletId, wallet: { userId } }, include: { wallet: true } })
  if (!session) throw new WalletError(404, "wallet-not-found")
  const network: WalletTestNetwork = testNetworkSchema.parse(session.wallet.network)
  const derivationContext = input.derivationContext ?? "base-output-v1"
  const completionHash = hash([input.transcriptHash, input.publicPackageHex, input.aToBHex, input.cToBHex, ...(derivationContext === "base-output-v1" ? [] : [derivationContext])])
  if (session.status === "completed") {
    if (session.completionHash !== completionHash) throw new WalletError(409, "dkg-request-changed")
    return { walletId, status: "recovery-required" as const, signingAvailable: false }
  }
  if (session.status !== "round2" || !session.encryptedState || session.expiresAt.getTime() <= Date.now() || session.transcriptHash !== input.transcriptHash) {
    throw new WalletError(409, "dkg-session-unavailable")
  }
  const aToB = Buffer.from(input.aToBHex, "hex")
  const cToB = Buffer.from(input.cToBHex, "hex")
  let result
  try {
    result = await finishCosignerDkg({ userId, walletId, network }, session.encryptedState, session.transcriptHash, aToB, cToB, Buffer.from(input.publicPackageHex, "hex"))
  } finally {
    aToB.fill(0)
    cToB.fill(0)
  }
  await prisma.$transaction(async tx => {
    const updated = await tx.walletProvisioning.updateMany({
      where: { id: session.id, version: session.version, status: "round2", expiresAt: { gt: new Date() } },
      data: { status: "completed", version: { increment: 1 }, completionHash, encryptedState: null },
    })
    if (updated.count !== 1) throw new WalletError(409, "dkg-state-changed")
    const wallet = await tx.walletAccount.updateMany({
      where: { id: walletId, userId, network, status: "provisioning" },
      data: { status: "recovery-required", publicPackage: Buffer.from(result.publicPackage), outputKey: Buffer.from(result.outputKey), derivationContext },
    })
    if (wallet.count !== 1) throw new WalletError(409, "dkg-state-changed")
    await tx.walletCosigner.create({ data: { walletId, encryptedShare: result.encryptedShare } })
  })
  return { walletId, status: "recovery-required" as const, signingAvailable: false }
}
