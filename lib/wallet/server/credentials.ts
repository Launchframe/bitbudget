import { randomBytes } from "node:crypto"
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from "@simplewebauthn/server"
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server"
import { prisma } from "@/lib/db"
import {
  requireCreationConfig, walletProfileId, challengeLifetimeMs, grantLifetimeMs, WalletError,
} from "@/lib/wallet/server/config"
import type { WalletTestNetwork } from "@/lib/wallet/server/config"

function binding(userId: string, network: WalletTestNetwork, operation: "register" | "create", origin: string) {
  const { rpId, origins } = requireCreationConfig()
  if (!origins.includes(origin)) throw new WalletError(403, "origin-rejected")
  return { userId, network, operation, origin, rpId, walletId: null, lineage: null, digest: null, profileId: walletProfileId }
}

function requireSameOriginCeremony(encoded: string) {
  try {
    const data = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
    if (data.crossOrigin === true || data.topOrigin !== undefined) throw new Error("Cross-origin ceremony")
  } catch {
    throw new WalletError(403, "credential-rejected")
  }
}

async function claimChallenge(id: string, scope: ReturnType<typeof binding>) {
  const now = new Date()
  const where = { id, ...scope, consumedAt: null, expiresAt: { gt: now } }
  const challenge = await prisma.walletChallenge.findFirst({ where })
  if (!challenge) throw new WalletError(403, "challenge-rejected")
  const claim = await prisma.walletChallenge.updateMany({ where, data: { consumedAt: now } })
  if (claim.count !== 1) throw new WalletError(403, "challenge-rejected")
  return challenge
}

export async function registrationOptions(userId: string, network: WalletTestNetwork, origin: string) {
  const scope = binding(userId, network, "register", origin)
  const existing = await prisma.walletCredential.findFirst({ where: { userId, rpId: scope.rpId }, select: { id: true } })
  if (existing) throw new WalletError(409, "credential-already-registered")
  const userHandle = randomBytes(32)
  const options = await generateRegistrationOptions({
    rpName: "BitBudget Wallet", rpID: scope.rpId, userName: "Wallet owner", userDisplayName: "Wallet owner",
    userID: userHandle, attestationType: "none", timeout: challengeLifetimeMs,
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    supportedAlgorithmIDs: [-7, -257],
  })
  const challenge = await prisma.walletChallenge.create({ data: {
    ...scope, challenge: options.challenge, userHandle: userHandle.toString("base64url"),
    expiresAt: new Date(Date.now() + challengeLifetimeMs),
  } })
  return { challengeId: challenge.id, options }
}

export async function registrationVerify(userId: string, network: WalletTestNetwork, origin: string, challengeId: string, response: RegistrationResponseJSON) {
  const scope = binding(userId, network, "register", origin)
  const challenge = await claimChallenge(challengeId, scope)
  requireSameOriginCeremony(response.response.clientDataJSON)
  let verification
  try {
    verification = await verifyRegistrationResponse({
      response, expectedChallenge: challenge.challenge, expectedOrigin: challenge.origin, expectedRPID: challenge.rpId,
      requireUserVerification: true, requireUserPresence: true, supportedAlgorithmIDs: [-7, -257],
    })
  } catch {
    throw new WalletError(403, "credential-rejected")
  }
  if (!verification.verified || !verification.registrationInfo.userVerified || !challenge.userHandle || challenge.expiresAt.getTime() <= Date.now()) {
    throw new WalletError(403, "credential-rejected")
  }
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo
  const grant = await prisma.$transaction(async tx => {
    await tx.walletCredential.create({ data: {
      userId, credentialId: credential.id, publicKey: Buffer.from(credential.publicKey), counter: BigInt(credential.counter),
      userHandle: challenge.userHandle!, rpId: scope.rpId, deviceType: credentialDeviceType, backedUp: credentialBackedUp,
    } })
    return tx.walletGrant.create({ data: {
      userId, network, operation: "create", walletId: null, lineage: null, digest: null, profileId: walletProfileId,
      credentialId: credential.id, expiresAt: new Date(Date.now() + grantLifetimeMs),
    }, select: { id: true, expiresAt: true } })
  })
  return { verified: true, grantId: grant.id, expiresAt: grant.expiresAt }
}

export async function authenticationOptions(userId: string, network: WalletTestNetwork, origin: string) {
  const scope = binding(userId, network, "create", origin)
  const credentials = await prisma.walletCredential.findMany({ where: { userId, rpId: scope.rpId }, select: { credentialId: true } })
  if (!credentials.length) throw new WalletError(409, "registration-required")
  const options = await generateAuthenticationOptions({
    rpID: scope.rpId, userVerification: "required", timeout: challengeLifetimeMs,
    allowCredentials: credentials.map(credential => ({ id: credential.credentialId })),
  })
  const challenge = await prisma.walletChallenge.create({ data: {
    ...scope, challenge: options.challenge, expiresAt: new Date(Date.now() + challengeLifetimeMs),
  } })
  return { challengeId: challenge.id, options }
}

export async function authenticationVerify(userId: string, network: WalletTestNetwork, origin: string, challengeId: string, response: AuthenticationResponseJSON) {
  const scope = binding(userId, network, "create", origin)
  const challenge = await claimChallenge(challengeId, scope)
  requireSameOriginCeremony(response.response.clientDataJSON)
  const credential = await prisma.walletCredential.findFirst({ where: { userId, rpId: scope.rpId, credentialId: response.id } })
  if (!credential || (response.response.userHandle != null && response.response.userHandle !== credential.userHandle)) {
    throw new WalletError(403, "credential-rejected")
  }
  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response, expectedChallenge: challenge.challenge, expectedOrigin: challenge.origin, expectedRPID: challenge.rpId,
      requireUserVerification: true,
      credential: { id: credential.credentialId, publicKey: new Uint8Array(credential.publicKey), counter: Number(credential.counter) },
    })
  } catch {
    throw new WalletError(403, "credential-rejected")
  }
  if (!verification.verified || !verification.authenticationInfo.userVerified || challenge.expiresAt.getTime() <= Date.now()) {
    throw new WalletError(403, "credential-rejected")
  }
  const grant = await prisma.$transaction(async tx => {
    const updated = await tx.walletCredential.updateMany({
      where: { id: credential.id, userId, counter: credential.counter, revision: credential.revision },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter), revision: { increment: 1 },
        backedUp: verification.authenticationInfo.credentialBackedUp,
      },
    })
    if (updated.count !== 1) throw new WalletError(403, "credential-rejected")
    return tx.walletGrant.create({ data: {
      userId, network, operation: "create", walletId: null, lineage: null, digest: null, profileId: walletProfileId,
      credentialId: credential.credentialId, expiresAt: new Date(Date.now() + grantLifetimeMs),
    }, select: { id: true, expiresAt: true } })
  })
  return { verified: true, grantId: grant.id, expiresAt: grant.expiresAt }
}
