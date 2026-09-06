import { prisma } from "@/lib/db"
import { testNetworkSchema, WalletError } from "@/lib/wallet/server/config"

const summarySelect = { id: true, network: true, status: true, createdAt: true, updatedAt: true } as const

function summary(wallet: { id: string; network: string; status: string; createdAt: Date; updatedAt: Date }) {
  if (!testNetworkSchema.safeParse(wallet.network).success) throw new WalletError(403, "network-rejected")
  return { ...wallet, lineages: ["sha256d", "blake2b"], signingAvailable: false, creationAvailable: false }
}

export async function listWallets(userId: string) {
  const wallets = await prisma.walletAccount.findMany({
    where: { userId, network: { in: [...testNetworkSchema.options] } }, select: summarySelect, orderBy: { createdAt: "asc" },
  })
  return { wallets: wallets.map(summary), creationAvailable: false, unavailableReason: "creation-unavailable" }
}

export async function walletStatus(userId: string, walletId: string) {
  const wallet = await prisma.walletAccount.findFirst({ where: { id: walletId, userId }, select: summarySelect })
  if (!wallet) throw new WalletError(404, "wallet-not-found")
  return { wallet: summary(wallet) }
}

