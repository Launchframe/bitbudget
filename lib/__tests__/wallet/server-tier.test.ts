import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { custodyTierAllowed, requireCustodyTier } from "@/lib/wallet/server/tier"
import { listWallets } from "@/lib/wallet/server/wallets"
import { walletSchemaColumns } from "@/lib/wallet/server/readiness"
import { POST } from "@/app/api/wallets/route"
import { WalletError } from "@/lib/wallet/server/config"

const mocks = vi.hoisted(() => ({
  premiumOrTrial: vi.fn(),
  query: vi.fn(), list: vi.fn(), credentials: vi.fn(), core: vi.fn(), auth: vi.fn(), start: vi.fn(),
}))
vi.mock("@/lib/subscription", () => ({ requirePremiumOrTrial: mocks.premiumOrTrial }))
vi.mock("@/lib/db", () => ({ prisma: { $queryRaw: mocks.query, walletAccount: { findMany: mocks.list }, walletCredential: { count: mocks.credentials } } }))
vi.mock("@/lib/wallet/server/mpc", () => ({ loadWalletMpc: mocks.core }))
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/wallet/server/provisioning", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/wallet/server/provisioning")>()),
  startProvisioning: mocks.start,
}))
const origin = "http://localhost:3001"

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("WALLET_WEBAUTHN_RP_ID", "localhost")
  vi.stubEnv("WALLET_WEBAUTHN_ORIGINS", origin)
  vi.stubEnv("WALLET_COSIGNER_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"))
  vi.stubEnv("WALLET_NETWORK", "signet")
  mocks.query.mockResolvedValue(walletSchemaColumns())
  mocks.list.mockResolvedValue([])
  mocks.credentials.mockResolvedValue(0)
  mocks.core.mockResolvedValue({})
  mocks.auth.mockResolvedValue({ user: { id: "owner" } })
  mocks.premiumOrTrial.mockResolvedValue(true)
  mocks.start.mockResolvedValue({ walletId: "w", status: "round2" })
})
afterEach(() => vi.unstubAllEnvs())

describe("custody tier gate", () => {
  it("allows premium and trial accounts and fails closed on lookup errors", async () => {
    expect(await custodyTierAllowed("owner")).toBe(true)
    mocks.premiumOrTrial.mockResolvedValue(false)
    expect(await custodyTierAllowed("owner")).toBe(false)
    mocks.premiumOrTrial.mockRejectedValue(new Error("db down"))
    expect(await custodyTierAllowed("owner")).toBe(false)
    await expect(requireCustodyTier("owner")).rejects.toMatchObject({ status: 403, code: "tier-required" } satisfies Partial<WalletError>)
  })

  it("reports custodyAllowed separately from server readiness so the hub can show an upgrade prompt", async () => {
    mocks.premiumOrTrial.mockResolvedValue(false)
    expect(await listWallets("owner", origin)).toMatchObject({ creationAvailable: true, custodyAllowed: false })
    mocks.premiumOrTrial.mockResolvedValue(true)
    expect(await listWallets("owner", origin)).toMatchObject({ creationAvailable: true, custodyAllowed: true })
  })

  it("rejects wallet creation for free accounts before touching the co-signer", async () => {
    mocks.premiumOrTrial.mockResolvedValue(false)
    const body = JSON.stringify({ network: "signet", grantId: "b8b699c4-161d-43cf-b414-581b92632bb4", aBroadcastHex: "00", cBroadcastHex: "00" })
    const request = new Request(`${origin}/api/wallets`, {
      method: "POST", body,
      headers: { origin, "content-type": "application/json", "content-length": String(body.length) },
    })
    const response = await POST(request)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: { code: "tier-required" } })
    expect(mocks.start).not.toHaveBeenCalled()
  })
})
