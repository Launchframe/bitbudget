import { createHash } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { testNetworkSchema, WalletError } from "@/lib/wallet/server/config"

export interface GrantBinding {
  userId: string
  walletId: string | null
  operation: "create" | "sign"
  network: string
  lineage: "sha256d" | "blake2b" | null
  profileId: string
  digest: string | null
}

export function validateGrantBinding(binding: GrantBinding) {
  if (!binding.userId || !binding.profileId || !testNetworkSchema.safeParse(binding.network).success) {
    throw new WalletError(400, "invalid-binding")
  }
  if (binding.operation === "sign" && (!binding.walletId || !binding.lineage || !binding.digest || !/^[0-9a-f]{64}$/.test(binding.digest))) {
    throw new WalletError(400, "invalid-binding")
  }
  if (binding.operation === "create" && (binding.walletId !== null || binding.lineage !== null || binding.digest !== null)) {
    throw new WalletError(400, "invalid-binding")
  }
}

export async function requireGrant(id: string, binding: GrantBinding) {
  validateGrantBinding(binding)
  const grant = await prisma.walletGrant.findFirst({ where: { id, ...binding, consumedAt: null, expiresAt: { gt: new Date() } } })
  if (!grant) throw new WalletError(403, "grant-rejected")
  return grant
}

export async function consumeGrant(tx: Prisma.TransactionClient, id: string, binding: GrantBinding) {
  validateGrantBinding(binding)
  const now = new Date()
  const result = await tx.walletGrant.updateMany({
    where: { id, ...binding, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  })
  if (result.count !== 1) throw new WalletError(403, "grant-rejected")
}

export async function burnSigningGrantAndCommitment(id: string, binding: GrantBinding, commitment: Uint8Array) {
  validateGrantBinding(binding)
  if (binding.operation !== "sign" || !binding.walletId || !binding.lineage || !binding.digest || !commitment.length || commitment.length > 16384) {
    throw new WalletError(400, "invalid-binding")
  }
  const { walletId, lineage, digest } = binding
  await prisma.$transaction(async tx => {
    const wallet = await tx.walletAccount.findFirst({ where: { id: walletId, userId: binding.userId, network: binding.network, status: "ready" }, select: { id: true } })
    if (!wallet) throw new WalletError(404, "wallet-not-found")
    await consumeGrant(tx, id, binding)
    await tx.walletNonceUse.create({ data: {
      grantId: id, userId: binding.userId, walletId, network: binding.network, lineage, profileId: binding.profileId, digest,
      commitmentHash: createHash("sha256").update(commitment).digest("hex"),
    } })
  })
}
