import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto"
import { isoCBOR } from "@simplewebauthn/server/helpers"
import { verifyRegistrationResponse, type AuthenticationResponseJSON, type RegistrationResponseJSON } from "@simplewebauthn/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { registrationOptions, registrationVerify, authenticationOptions, authenticationVerify } from "@/lib/wallet/server/credentials"

const db = vi.hoisted(() => ({
  walletCredential: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  walletChallenge: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  walletGrant: { create: vi.fn() },
  walletAccount: { findFirst: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ prisma: { ...db, $transaction: async (action: (tx: typeof db) => unknown) => action(db) } }))
const origin = "https://wallet.example.test"
const rpId = "wallet.example.test"
const user = "synthetic-user"
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest()
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url")

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("WALLET_WEBAUTHN_RP_ID", rpId)
  vi.stubEnv("WALLET_WEBAUTHN_ORIGINS", origin)
  vi.stubEnv("WALLET_COSIGNER_ENCRYPTION_KEY", randomBytes(32).toString("base64"))
  db.walletCredential.findFirst.mockResolvedValue(null)
  db.walletChallenge.create.mockImplementation(async ({ data }) => ({ ...data, id: "challenge-id" }))
  db.walletChallenge.updateMany.mockResolvedValue({ count: 1 })
  db.walletCredential.updateMany.mockResolvedValue({ count: 1 })
  db.walletGrant.create.mockResolvedValue({ id: "grant-id", expiresAt: new Date(Date.now() + 60_000) })
})
afterEach(() => vi.unstubAllEnvs())

async function registrationFixture() {
  const { options, challengeId } = await registrationOptions(user, "regtest", origin)
  const challenge = { ...db.walletChallenge.create.mock.calls[0][0].data, id: challengeId }
  db.walletChallenge.findFirst.mockResolvedValue(challenge)
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  const jwk = keys.publicKey.export({ format: "jwk" })
  const cose = isoCBOR.encode(new Map<number, number | Uint8Array>([
    [1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x!, "base64url"))], [-3, new Uint8Array(Buffer.from(jwk.y!, "base64url"))],
  ]))
  const credential = randomBytes(32)
  const length = Buffer.alloc(2)
  length.writeUInt16BE(credential.length)
  const authData = Buffer.concat([hash(rpId), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), length, credential, cose])
  const attestation = isoCBOR.encode(new Map<string, string | Uint8Array | Map<string, never>>([
    ["fmt", "none"], ["attStmt", new Map<string, never>()], ["authData", new Uint8Array(authData)],
  ]))
  expect(cose[0]).toBe(0xa5)
  expect(isoCBOR.decodeFirst<Map<string, unknown>>(attestation).get("authData")).toEqual(new Uint8Array(authData))
  expect(authData.readUInt16BE(53)).toBe(32)
  expect(authData[87]).toBe(0xa5)
  const response: RegistrationResponseJSON = {
    id: base64(credential), rawId: base64(credential), type: "public-key", authenticatorAttachment: "platform",
    clientExtensionResults: { credProps: { rk: true } },
    response: {
      clientDataJSON: base64(Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin, crossOrigin: false }))),
      attestationObject: base64(attestation), transports: ["internal"],
    },
  }
  expect((await verifyRegistrationResponse({ response, expectedChallenge: options.challenge, expectedOrigin: origin, expectedRPID: rpId, requireUserVerification: true })).verified).toBe(true)
  return { keys, response, challengeId, challenge }
}

async function authenticationFixture(walletId: string | null = null) {
  const fixture = await registrationFixture()
  await registrationVerify(user, "regtest", origin, fixture.challengeId, fixture.response)
  const credential = { ...db.walletCredential.create.mock.calls[0][0].data, id: "credential-row", revision: 0 }
  db.walletCredential.findFirst.mockResolvedValue(credential)
  db.walletCredential.findMany.mockResolvedValue([{ credentialId: credential.credentialId }])
  if (walletId) db.walletAccount.findFirst.mockResolvedValue({ id: walletId })
  const { options, challengeId } = await authenticationOptions(user, "regtest", origin, walletId)
  const calls = db.walletChallenge.create.mock.calls
  db.walletChallenge.findFirst.mockResolvedValue({ ...calls[calls.length - 1][0].data, id: challengeId })
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin, crossOrigin: false }))
  const counter = Buffer.alloc(4)
  counter.writeUInt32BE(1)
  const authenticator = Buffer.concat([hash(rpId), Buffer.from([0x05]), counter])
  const signature = sign("sha256", Buffer.concat([authenticator, hash(clientData)]), fixture.keys.privateKey)
  const response: AuthenticationResponseJSON = {
    id: credential.credentialId, rawId: credential.credentialId, type: "public-key", authenticatorAttachment: "platform",
    clientExtensionResults: {}, response: { clientDataJSON: base64(clientData), authenticatorData: base64(authenticator), signature: base64(signature), userHandle: credential.userHandle },
  }
  return { ...fixture, response, challengeId, credential }
}

describe("verified wallet WebAuthn ceremonies", () => {
  it("registers a structurally valid attestation and records a scoped one-use creation grant", async () => {
    const { response, challengeId } = await registrationFixture()
    expect(await registrationVerify(user, "regtest", origin, challengeId, response)).toMatchObject({ verified: true, grantId: "grant-id" })
    expect(db.walletCredential.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: user, credentialId: response.id, publicKey: expect.any(Buffer), counter: BigInt(0), rpId }) })
    expect(db.walletGrant.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: user, network: "regtest", operation: "create", walletId: null, lineage: null, digest: null }) }))
    db.walletChallenge.updateMany.mockResolvedValue({ count: 0 })
    await expect(registrationVerify(user, "regtest", origin, challengeId, response)).rejects.toThrow("challenge-rejected")
    expect(db.walletCredential.create).toHaveBeenCalledTimes(1)
  })

  it("verifies a real P-256 assertion signature and advances the credential revision atomically", async () => {
    const { response, challengeId } = await authenticationFixture()
    expect(await authenticationVerify(user, "regtest", origin, challengeId, response)).toMatchObject({ verified: true })
    expect(db.walletCredential.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ userId: user, counter: BigInt(0), revision: 0 }), data: expect.objectContaining({ counter: BigInt(1), revision: { increment: 1 } }) })
  })

  it("binds device-unlock assertions to the wallet without minting another creation grant", async () => {
    const walletId = "wallet-being-unlocked"
    const { response, challengeId } = await authenticationFixture(walletId)
    await authenticationVerify(user, "regtest", origin, challengeId, response, walletId)
    expect(db.walletChallenge.findFirst).toHaveBeenLastCalledWith({ where: expect.objectContaining({ userId: user, walletId, operation: "unlock", network: "regtest" }) })
    expect(db.walletGrant.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ operation: "unlock", walletId }) }))
    db.walletAccount.findFirst.mockResolvedValue(null)
    await expect(authenticationOptions(user, "regtest", origin, "another-wallet")).rejects.toThrow("wallet-not-found")
  })

  it("rejects tampered signatures rather than trusting a credential ID", async () => {
    const { response, challengeId } = await authenticationFixture()
    await expect(authenticationVerify(user, "regtest", origin, challengeId, { ...response, response: { ...response.response, signature: base64(randomBytes(70)) } })).rejects.toThrow("credential-rejected")
    expect(db.walletCredential.updateMany).not.toHaveBeenCalled()
  })

  it("rejects cross-origin ceremonies, expired challenges and missing ownership binding", async () => {
    const { response, challengeId, challenge } = await registrationFixture()
    const data = JSON.parse(Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8"))
    await expect(registrationVerify(user, "regtest", origin, challengeId, { ...response, response: { ...response.response, clientDataJSON: base64(Buffer.from(JSON.stringify({ ...data, crossOrigin: true }))) } })).rejects.toThrow("credential-rejected")
    db.walletChallenge.findFirst.mockResolvedValue({ ...challenge, expiresAt: new Date(0) })
    await expect(registrationVerify(user, "regtest", origin, challengeId, response)).rejects.toThrow("credential-rejected")
    db.walletChallenge.findFirst.mockResolvedValue(null)
    await expect(registrationVerify("other-user", "regtest", origin, challengeId, response)).rejects.toThrow("challenge-rejected")
    expect(db.walletChallenge.findFirst).toHaveBeenLastCalledWith({ where: expect.objectContaining({ userId: "other-user", operation: "register", walletId: null, origin, rpId, consumedAt: null }) })
    expect(db.walletCredential.create).not.toHaveBeenCalled()
  })

  it("rejects a wrong user handle and a concurrently changed credential", async () => {
    const { response, challengeId } = await authenticationFixture()
    await expect(authenticationVerify(user, "regtest", origin, challengeId, { ...response, response: { ...response.response, userHandle: "wrong-handle" } })).rejects.toThrow("credential-rejected")
    db.walletCredential.updateMany.mockResolvedValue({ count: 0 })
    await expect(authenticationVerify(user, "regtest", origin, challengeId, response)).rejects.toThrow("credential-rejected")
    expect(db.walletGrant.create).toHaveBeenCalledTimes(1)
  })
})
