import { createHash } from "node:crypto"
import { prisma } from "@/lib/db"
import { testNetworkSchema, WalletError } from "@/lib/wallet/server/config"
import { walletReadiness, type WalletReadinessIssue } from "@/lib/wallet/server/readiness"
import { custodyTierAllowed } from "@/lib/wallet/server/tier"

const summarySelect = { id: true, network: true, status: true, recoveryVerifiedAt: true, derivationContext: true, publicPackage: true, createdAt: true, updatedAt: true } as const

function summary(wallet: { id: string; network: string; status: string; recoveryVerifiedAt: Date | null; derivationContext: string; publicPackage: Uint8Array | null; createdAt: Date; updatedAt: Date }) {
  if (!testNetworkSchema.safeParse(wallet.network).success) throw new WalletError(403, "network-rejected")
  const { publicPackage, ...metadata } = wallet
  return { ...metadata, publicPackageHash: publicPackage ? createHash("sha256").update(publicPackage).digest("hex") : null, lineages: ["sha256d", "blake2b"], signingAvailable: false }
}

export async function listWallets(userId: string, origin?: string) {
  const readiness = await walletReadiness(origin)
  const custodyAllowed = await custodyTierAllowed(userId)
  const unavailable = (issues: WalletReadinessIssue[]) => ({ wallets: [], creationAvailable: false, custodyAllowed, unavailableReason: "creation-unavailable", issues, network: readiness.network })
  if (!readiness.schemaReady) return unavailable(readiness.issues)
  try {
    const wallets = await prisma.walletAccount.findMany({
      where: { userId, network: { in: [...testNetworkSchema.options] } }, select: summarySelect, orderBy: { createdAt: "asc" },
    })
    const registered = readiness.rpId ? await prisma.walletCredential.count({ where: { userId, rpId: readiness.rpId } }) : 0
    // `creationAvailable` is server readiness only; `custodyAllowed` is the
    // account's tier. The hub shows an upgrade prompt when the first is true
    // and the second is false.
    return { wallets: wallets.map(summary), creationAvailable: readiness.issues.length === 0, custodyAllowed, network: readiness.network, hasCredential: registered > 0, issues: readiness.issues }
  } catch {
    return unavailable([...readiness.issues, "database"])
  }
}

export async function walletStatus(userId: string, walletId: string) {
  const wallet = await prisma.walletAccount.findFirst({ where: { id: walletId, userId }, select: summarySelect })
  if (!wallet) throw new WalletError(404, "wallet-not-found")
  return { wallet: summary(wallet) }
}

