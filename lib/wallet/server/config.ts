import { z } from "zod"

export class WalletError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code)
  }
}

export const testNetworkSchema = z.enum(["signet", "testnet4", "regtest"])
export type WalletTestNetwork = z.infer<typeof testNetworkSchema>
export const walletProfileId = "dual-lineage-v1"
export const challengeLifetimeMs = 120_000
export const grantLifetimeMs = 60_000

export function assertServerRuntime() {
  if (typeof window !== "undefined" || Number(process.versions.node.split(".")[0]) < 22) {
    throw new WalletError(503, "creation-unavailable")
  }
}

export function walletConfig() {
  assertServerRuntime()
  const rpId = process.env.WALLET_WEBAUTHN_RP_ID
  const rawOrigins = process.env.WALLET_WEBAUTHN_ORIGINS
  if (!rpId || !rawOrigins || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(rpId)) {
    throw new WalletError(503, "creation-unavailable")
  }
  const origins = rawOrigins.split(",")
  if (!origins.length || origins.length > 10) throw new WalletError(503, "creation-unavailable")
  for (const origin of origins) {
    let url: URL
    try { url = new URL(origin) } catch { throw new WalletError(503, "creation-unavailable") }
    const local = process.env.NODE_ENV !== "production" && url.hostname === "localhost"
    if (url.origin !== origin || url.username || url.password ||
        (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
        (url.hostname !== rpId && !url.hostname.endsWith(`.${rpId}`))) {
      throw new WalletError(503, "creation-unavailable")
    }
  }
  return { rpId, origins }
}

export function encryptionKey(): Buffer {
  assertServerRuntime()
  const value = process.env.WALLET_COSIGNER_ENCRYPTION_KEY
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new WalletError(503, "creation-unavailable")
  const key = Buffer.from(value, "base64")
  if (key.length !== 32 || key.toString("base64") !== value || key.every(byte => byte === 0)) {
    key.fill(0)
    throw new WalletError(503, "creation-unavailable")
  }
  return key
}

export function requireCreationConfig() {
  const config = walletConfig()
  encryptionKey().fill(0)
  return config
}
