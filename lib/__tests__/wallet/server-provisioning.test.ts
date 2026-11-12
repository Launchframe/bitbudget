import { randomBytes } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { startProvisioning, finishProvisioning, startProvisioningSchema } from "@/lib/wallet/server/provisioning"
import { loadWalletMpc } from "@/lib/wallet/server/mpc"

const db = vi.hoisted(() => ({
  walletProvisioning: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  walletAccount: { create: vi.fn(), updateMany: vi.fn() },
  walletCosigner: { create: vi.fn() },
  walletGrant: { findFirst: vi.fn(), updateMany: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ prisma: { ...db, $transaction: async (action: (tx: typeof db) => unknown) => action(db) } }))

const userId = "test-account"
const grantId = "b8b699c4-161d-43cf-b414-581b92632bb4"
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex")

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("WALLET_WEBAUTHN_RP_ID", "wallet.example.test")
  vi.stubEnv("WALLET_WEBAUTHN_ORIGINS", "https://wallet.example.test")
  vi.stubEnv("WALLET_COSIGNER_ENCRYPTION_KEY", randomBytes(32).toString("base64"))
  db.walletProvisioning.findFirst.mockResolvedValue(null)
  db.walletGrant.findFirst.mockResolvedValue({ id: grantId })
  db.walletGrant.updateMany.mockResolvedValue({ count: 1 })
  db.walletProvisioning.updateMany.mockResolvedValue({ count: 1 })
  db.walletAccount.updateMany.mockResolvedValue({ count: 1 })
})
afterEach(() => vi.unstubAllEnvs())

async function start() {
  const core = await loadWalletMpc()
  const a = new core.WasmDkgRound1(1)
  const c = new core.WasmDkgRound1(3)
  const aBroadcast = a.broadcast()
  const cBroadcast = c.broadcast()
  const request = { network: "regtest" as const, grantId, aBroadcastHex: hex(aBroadcast), cBroadcastHex: hex(cBroadcast) }
  const response = await startProvisioning(userId, request)
  const stored = db.walletProvisioning.create.mock.calls[0][0].data
  const session = {
    ...stored, id: "session-id", version: 0,
    wallet: { id: response.walletId, userId, network: "regtest", status: "provisioning" },
  }
  db.walletProvisioning.findFirst.mockResolvedValue(session)
  return { core, a, c, aBroadcast, cBroadcast, request, response, session }
}

describe("provisioning orchestration", () => {
  it("atomically consumes the creation grant and stores only encrypted B round state and response", async () => {
    const fixture = await start()
    expect(db.walletGrant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: grantId, userId, operation: "create", walletId: null, lineage: null, consumedAt: null }),
    }))
    expect(fixture.session.encryptedState).toBeInstanceOf(Buffer)
    expect(fixture.session.encryptedResponse).toBeInstanceOf(Buffer)
    expect(fixture.session.encryptedResponse.includes(Buffer.from(fixture.response.bToAHex))).toBe(false)
    expect(fixture.session).not.toHaveProperty("shareA")
    expect(fixture.session).not.toHaveProperty("shareC")
    expect(fixture.response).not.toHaveProperty("encryptedState")
    fixture.a.free(); fixture.c.free()
  })

  it("replays an identical request without consuming another grant or creating different keys", async () => {
    const fixture = await start()
    expect(await startProvisioning(userId, fixture.request)).toEqual(fixture.response)
    expect(db.walletAccount.create).toHaveBeenCalledTimes(1)
    expect(db.walletGrant.updateMany).toHaveBeenCalledTimes(1)
    expect(db.walletProvisioning.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { grantId, wallet: { userId, network: "regtest" } } }))
    await expect(startProvisioning(userId, { ...fixture.request, cBroadcastHex: fixture.request.aBroadcastHex })).rejects.toThrow("dkg-request-changed")
    fixture.a.free(); fixture.c.free()
  })

  it("finishes real DKG into recovery-required, never ready or signing-enabled", async () => {
    const fixture = await start()
    const { a, c, aBroadcast, cBroadcast, response } = fixture
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
    expect(await finishProvisioning(userId, response.walletId, completion)).toEqual({ walletId: response.walletId, status: "recovery-required", signingAvailable: false })
    expect(db.walletAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: response.walletId, userId, network: "regtest", status: "provisioning" },
      data: expect.objectContaining({ status: "recovery-required", outputKey: Buffer.from(aShare.output_key()) }),
    }))
    expect(db.walletCosigner.create).toHaveBeenCalledWith({ data: { walletId: response.walletId, encryptedShare: expect.any(Buffer) } })
    const update = db.walletProvisioning.updateMany.mock.calls[0][0]
    expect(update.where).toMatchObject({ id: fixture.session.id, version: 0, status: "round2" })
    expect(update.data.encryptedState).toBeNull()
    db.walletProvisioning.findFirst.mockResolvedValue({ ...fixture.session, ...update.data })
    expect(await finishProvisioning(userId, response.walletId, completion)).toMatchObject({ status: "recovery-required", signingAvailable: false })
    expect(db.walletCosigner.create).toHaveBeenCalledTimes(1)
    await expect(finishProvisioning(userId, response.walletId, { ...completion, transcriptHash: "00".repeat(32) })).rejects.toThrow("dkg-request-changed")
    aShare.free(); cShare.free(); aToB.fill(0); cToB.fill(0); aToC.fill(0); cToA.fill(0)
  })

  it("refuses expired sessions and concurrent grant consumption without creating a wallet", async () => {
    const fixture = await start()
    db.walletProvisioning.findFirst.mockResolvedValue({ ...fixture.session, expiresAt: new Date(0) })
    await expect(startProvisioning(userId, fixture.request)).rejects.toThrow("dkg-session-unavailable")
    db.walletProvisioning.findFirst.mockResolvedValue(null)
    db.walletGrant.updateMany.mockResolvedValue({ count: 0 })
    await expect(startProvisioning(userId, fixture.request)).rejects.toThrow("grant-rejected")
    expect(db.walletAccount.create).toHaveBeenCalledTimes(1)
    fixture.a.free(); fixture.c.free()
  })

  it("rejects mainnet, private extra fields, and missing credentials before DKG", async () => {
    expect(startProvisioningSchema.safeParse({ network: "mainnet", grantId, aBroadcastHex: "00", cBroadcastHex: "00" }).success).toBe(false)
    expect(startProvisioningSchema.safeParse({ network: "regtest", grantId, aBroadcastHex: "00", cBroadcastHex: "00", shareA: "private" }).success).toBe(false)
    db.walletGrant.findFirst.mockResolvedValue(null)
    await expect(startProvisioning(userId, { network: "regtest", grantId, aBroadcastHex: "00", cBroadcastHex: "00" })).rejects.toThrow("grant-rejected")
    expect(db.walletAccount.create).not.toHaveBeenCalled()
  })
})
