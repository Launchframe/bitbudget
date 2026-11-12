import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { assertServerRuntime, encryptionKey, testNetworkSchema, walletConfig } from "@/lib/wallet/server/config"
import { loadWalletMpc } from "@/lib/wallet/server/mpc"

export type WalletReadinessIssue = "node-runtime" | "webauthn-config" | "webauthn-origin" | "cosigner-key" | "network-config" | "wallet-schema" | "database" | "wasm"
const TABLES = ["WalletAccount", "WalletCredential", "WalletChallenge", "WalletGrant", "WalletCosigner", "WalletProvisioning", "WalletNonceUse"] as const

export function walletSchemaColumns() {
  return TABLES.flatMap(name => {
    const model = Prisma.dmmf.datamodel.models.find(model => model.name === name)
    if (!model) throw new Error("Wallet database client needs generation")
    return model.fields.filter(field => field.kind !== "object").map(field => ({ tableName: model.dbName ?? name, columnName: field.dbName ?? field.name }))
  })
}

export async function walletReadiness(origin?: string) {
  const issues: WalletReadinessIssue[] = []
  let rpId: string | undefined
  let schemaReady = false
  try { assertServerRuntime() } catch { return { issues: ["node-runtime"] as WalletReadinessIssue[], schemaReady, rpId, network: undefined } }
  try {
    const config = walletConfig()
    rpId = config.rpId
    if (origin && !config.origins.includes(origin)) issues.push("webauthn-origin")
  } catch { issues.push("webauthn-config") }
  try { encryptionKey().fill(0) } catch { issues.push("cosigner-key") }
  const network = testNetworkSchema.safeParse(process.env.WALLET_NETWORK ?? "signet")
  if (!network.success) issues.push("network-config")
  try { await loadWalletMpc() } catch { issues.push("wasm") }
  try {
    const expected = walletSchemaColumns()
    const columns = await prisma.$queryRaw<{ tableName: string; columnName: string }[]>(Prisma.sql`
      SELECT table_name AS "tableName", column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name IN (${Prisma.join([...TABLES])})
    `)
    const present = new Set(columns.map(column => `${column.tableName}.${column.columnName}`))
    schemaReady = expected.every(column => present.has(`${column.tableName}.${column.columnName}`))
    if (!schemaReady) issues.push("wallet-schema")
  } catch { issues.push("database") }
  return { issues, schemaReady, rpId, network: network.success ? network.data : undefined }
}
