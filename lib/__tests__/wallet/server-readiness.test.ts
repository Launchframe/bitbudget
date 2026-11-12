import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { walletReadiness, walletSchemaColumns } from "@/lib/wallet/server/readiness"
import { listWallets } from "@/lib/wallet/server/wallets"
import { GET } from "@/app/api/wallets/route"

const mocks = vi.hoisted(() => ({ query: vi.fn(), list: vi.fn(), credentials: vi.fn(), core: vi.fn(), auth: vi.fn() }))
vi.mock("@/lib/db", () => ({ prisma: { $queryRaw: mocks.query, walletAccount: { findMany: mocks.list }, walletCredential: { count: mocks.credentials } } }))
vi.mock("@/lib/wallet/server/mpc", () => ({ loadWalletMpc: mocks.core }))
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
const origin = "http://localhost:3001"

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("WALLET_WEBAUTHN_RP_ID", "localhost")
  vi.stubEnv("WALLET_WEBAUTHN_ORIGINS", origin)
  vi.stubEnv("WALLET_COSIGNER_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"))
  vi.stubEnv("WALLET_NETWORK", "signet")
  vi.stubEnv("BITCOIN_SHA256_RPC_PASS", "synthetic-value-that-must-not-be-returned")
  mocks.query.mockResolvedValue(walletSchemaColumns())
  mocks.list.mockResolvedValue([])
  mocks.credentials.mockResolvedValue(0)
  mocks.core.mockResolvedValue({})
  mocks.auth.mockResolvedValue({ user: { id: "owner" } })
})
afterEach(() => vi.unstubAllEnvs())

describe("safe wallet availability diagnostics", () => {
  it("reports ready only after configuration, artifact and schema checks", async () => {
    expect(await listWallets("owner", origin)).toMatchObject({ creationAvailable: true, issues: [], network: "signet" })
    expect(mocks.query).toHaveBeenCalledOnce()
    expect(mocks.query.mock.calls[0][0].sql).toMatch(/SELECT[\s\S]*information_schema\.columns/)
  })

  it("reports missing schema without querying nonexistent wallet tables", async () => {
    mocks.query.mockResolvedValue([])
    expect(await listWallets("owner", origin)).toMatchObject({ creationAvailable: false, issues: ["wallet-schema"] })
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.credentials).not.toHaveBeenCalled()
    mocks.query.mockResolvedValue(walletSchemaColumns().filter(column => !(column.tableName === "WalletChallenge" && column.columnName === "payloadHash")))
    expect((await walletReadiness(origin)).issues).toEqual(["wallet-schema"])
  })

  it("separates origin, key, network, database and artifact failures without returning secret values", async () => {
    vi.stubEnv("WALLET_COSIGNER_ENCRYPTION_KEY", "synthetic-invalid-secret")
    vi.stubEnv("WALLET_NETWORK", "mainnet")
    mocks.query.mockRejectedValue(new Error("must not echo database connection details"))
    mocks.core.mockRejectedValue(new Error("must not echo artifact path"))
    const response = await listWallets("owner", "http://127.0.0.1:3001")
    expect(response).toMatchObject({ creationAvailable: false, issues: ["webauthn-origin", "cosigner-key", "network-config", "wasm", "database"] })
    expect(JSON.stringify(response)).not.toMatch(/synthetic|connection details|artifact path/)
  })

  it("reports absent WebAuthn settings without exposing environment contents", async () => {
    vi.stubEnv("WALLET_WEBAUTHN_RP_ID", undefined)
    vi.stubEnv("WALLET_WEBAUTHN_ORIGINS", undefined)
    expect((await listWallets("owner", origin)).issues).toEqual(["webauthn-config"])
  })

  it("checks authentication before exposing diagnostics and keeps the response noncacheable", async () => {
    mocks.auth.mockResolvedValue(null)
    const response = await GET(new Request(`${origin}/api/wallets`))
    expect(response.status).toBe(401)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.core).not.toHaveBeenCalled()
  })
})
