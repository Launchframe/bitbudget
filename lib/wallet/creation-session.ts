import * as core from "@/wallet-mpc/pkg/wallet_mpc.js"
import { z } from "zod"
import { walletRequest, WalletClientError } from "@/lib/wallet/client-http"
import { bytesToHex, hexToBytes, sha256Hex, utf8ToHex } from "@/lib/wallet/public-data-tools"
import { wrapDeviceShare, unwrapDeviceShare, walletPublicContext, type ShareCustodyContext } from "@/lib/wallet/client-custody"
import { createRecoveryPackage, decryptRecoveryPackage, serializeRecoveryPackage } from "@/lib/wallet/recovery-package"
import { openWalletCustodyStore, type StoredWalletCustody, type WalletCustodyStore } from "@/lib/wallet/wallet-idb"
import { sealCreationDraft, openCreationDraft } from "@/lib/wallet/creation-draft"

const hex = z.string().min(2).max(16384).regex(/^(?:[0-9a-f]{2})+$/)
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const startedSchema = z.object({ walletId: z.string().uuid(), status: z.literal("round2"), bBroadcastHex: hex, bToAHex: hex, bToCHex: hex, transcriptHash: hash })
const completionSchema = z.object({ aToBHex: hex, cToBHex: hex, publicPackageHex: hex, transcriptHash: hash }).strict()
const finishedSchema = z.object({ walletId: z.string().uuid(), status: z.enum(["recovery-required", "ready"]), signingAvailable: z.literal(false) })
const challengeSchema = z.object({ challengeId: z.string().uuid(), digest: hash, nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/), expiresAt: z.string().datetime() })
const verifiedSchema = z.object({ walletId: z.string().uuid(), status: z.literal("ready"), recoveryVerifiedAt: z.string().datetime(), signingAvailable: z.literal(false) })

export interface CreationIdentity { userId: string; credentialId: string; prf: Uint8Array<ArrayBuffer> }
export interface CreationInput extends CreationIdentity { network: "signet" | "testnet4" | "regtest"; grantId: string; password: string; encryptedName: string }
export type CreationProgress = { stage: "creating" | "securing" | "saved" | "finishing"; walletId?: string }

function initializeCore() {
  const asset = new URL("../../wallet-mpc/pkg/wallet_mpc_bg.wasm", import.meta.url)
  const url = typeof location === "undefined" ? asset.href : new URL(asset.href, location.origin).href
  return core.default({ module_or_path: url })
}

function equal(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i]
  return difference === 0
}

function resources() {
  const live = new Set<{ free(): void }>()
  return {
    keep<T extends { free(): void }>(value: T): T { live.add(value); return value },
    consume<T extends { free(): void }, R>(value: T, action: () => R): R { live.delete(value); return action() },
    close() { for (const value of live) value.free(); live.clear() },
  }
}

function binding(identity: CreationIdentity, walletId: string, network: string) {
  return { accountId: identity.userId, walletId, credentialId: identity.credentialId, network }
}

async function finishSaved(identity: CreationIdentity, record: StoredWalletCustody) {
  if (record.envelopes.deviceShare?.credentialId !== identity.credentialId) throw new WalletClientError("credential-rejected")
  if (!record.pendingCreation) return record
  const body = completionSchema.parse(await openCreationDraft(record.pendingCreation, identity.prf, binding(identity, record.identity.id, record.identity.network)))
  const result = finishedSchema.parse(await walletRequest(`/api/wallets/${record.identity.id}/dkg`, body))
  if (result.walletId !== record.identity.id) throw new WalletClientError("wallet-response-mismatch")
  const store = await openWalletCustodyStore(identity.userId)
  try { return await store.completeCreation(record.identity.id, record.revision) } finally { store.close() }
}

export async function createBrowserWallet(input: CreationInput, progress: (event: CreationProgress) => void) {
  const buffers: Uint8Array[] = [input.prf]
  const owned = resources()
  try {
    if (!input.userId || !input.credentialId || input.prf.length !== 32 || input.password.length < 12 || input.password.length > 1024 || !/^[0-9a-f]{24}:(?:[0-9a-f]{2}){16,}$/.test(input.encryptedName) || input.encryptedName.length > 4096 || !["regtest", "signet", "testnet4"].includes(input.network)) throw new WalletClientError("invalid-creation-input")
    try { await initializeCore() } catch { throw new WalletClientError("wallet-core-load-failed") }
    progress({ stage: "creating" })
    const a = owned.keep(new core.WasmDkgRound1(1))
    const c = owned.keep(new core.WasmDkgRound1(3))
    const aBroadcast = a.broadcast()
    const cBroadcast = c.broadcast()
    const started = startedSchema.parse(await walletRequest("/api/wallets", { network: input.network, grantId: input.grantId, aBroadcastHex: bytesToHex(aBroadcast), cBroadcastHex: bytesToHex(cBroadcast) }))
    const bBroadcast = hexToBytes(started.bBroadcastHex)
    const a2 = owned.keep(owned.consume(a, () => a.advance(2, bBroadcast, 3, cBroadcast)))
    const c2 = owned.keep(owned.consume(c, () => c.advance(1, aBroadcast, 2, bBroadcast)))
    if (bytesToHex(a2.broadcast_digest()) !== started.transcriptHash || bytesToHex(c2.broadcast_digest()) !== started.transcriptHash) throw new WalletClientError("dkg-transcript-mismatch")
    const aToB = a2.take_message(2), cToB = c2.take_message(2), aToC = a2.take_message(3), cToA = c2.take_message(1)
    const bToA = hexToBytes(started.bToAHex), bToC = hexToBytes(started.bToCHex)
    buffers.push(aToB, cToB, aToC, cToA, bToA, bToC)
    const shareA = owned.keep(owned.consume(a2, () => a2.finish(2, bToA, 3, cToA)))
    const shareC = owned.keep(owned.consume(c2, () => c2.finish(1, aToC, 2, bToC)))
    const publicPackage = shareA.public_package()
    if (!equal(publicPackage, shareC.public_package()) || !equal(shareA.output_key(), shareC.output_key())) throw new WalletClientError("dkg-public-package-mismatch")
    const context: ShareCustodyContext = {
      accountId: input.userId, walletId: started.walletId, network: input.network,
      participantId: "1", role: "A", shareFormat: "frost-secp256k1-tr-v3", groupPublicKeyHex: bytesToHex(shareA.output_key()), publicPackageHex: bytesToHex(publicPackage),
      policy: { threshold: 2, participants: 3 }, derivationContext: "base-output-v1",
    }
    const secretA = shareA.export_secret_share(), secretC = shareC.export_secret_share()
    buffers.push(secretA, secretC)
    progress({ stage: "securing", walletId: started.walletId })
    const deviceShare = await wrapDeviceShare({ share: secretA, context, credentialId: input.credentialId, prfOutput: input.prf })
    const recoveryShare = await createRecoveryPackage({ share: secretC, context: { ...context, participantId: "3", role: "C" }, password: input.password })
    const pendingCreation = await sealCreationDraft({ aToBHex: bytesToHex(aToB), cToBHex: bytesToHex(cToB), publicPackageHex: bytesToHex(publicPackage), transcriptHash: started.transcriptHash }, input.prf, binding(input, started.walletId, input.network))
    const store = await openWalletCustodyStore(input.userId)
    let record
    try {
      record = await store.createWallet({ context: walletPublicContext(context), envelopes: { deviceShare, recoveryShare, optionalDeviceExport: null }, pendingCreation, encryptedName: input.encryptedName })
    } finally { store.close() }
    progress({ stage: "saved", walletId: record.identity.id })
    progress({ stage: "finishing", walletId: record.identity.id })
    record = await finishSaved(input, record)
    return { walletId: record.identity.id, recoveryFile: serializeRecoveryPackage(record.envelopes.recoveryShare) }
  } finally {
    for (const value of buffers) value.fill(0)
    owned.close()
  }
}

export async function resumeBrowserWallet(input: CreationIdentity & { walletId: string }) {
  let store: WalletCustodyStore | undefined
  try {
    store = await openWalletCustodyStore(input.userId)
    const saved = await store.getWallet(input.walletId)
    if (!saved) throw new WalletClientError("device-share-unavailable")
    const record = await finishSaved(input, saved)
    return { walletId: record.identity.id, recoveryFile: serializeRecoveryPackage(record.envelopes.recoveryShare) }
  } finally { input.prf.fill(0); store?.close() }
}

export async function verifyBrowserRecovery(input: CreationIdentity & { walletId: string; password: string; file: string }) {
  let store: WalletCustodyStore | undefined
  const buffers: Uint8Array[] = [input.prf]
  const owned = resources()
  try {
    await initializeCore()
    store = await openWalletCustodyStore(input.userId)
    const saved = await store.getWallet(input.walletId)
    if (!saved?.envelopes.deviceShare) throw new WalletClientError("device-share-unavailable")
    const record = await finishSaved(input, saved)
    const recovered = await decryptRecoveryPackage({ envelope: input.file, expectedContext: record.envelopes.recoveryShare.context, password: input.password })
    buffers.push(recovered.share)
    const secretA = await unwrapDeviceShare({ envelope: record.envelopes.deviceShare, expectedContext: record.envelopes.deviceShare!.context, credentialId: input.credentialId, prfOutput: input.prf })
    buffers.push(secretA)
    const pub = hexToBytes(record.context.publicPackageHex)
    const a = owned.keep(core.WasmWalletShare.import_secret_share(1, secretA, pub))
    const c = owned.keep(core.WasmWalletShare.import_secret_share(3, recovered.share, pub))
    if (!equal(a.output_key(), c.output_key()) || bytesToHex(c.output_key()) !== record.context.groupPublicKeyHex) throw new WalletClientError("recovery-proof-rejected")
    const backupHash = await sha256Hex(utf8ToHex(input.file))
    const challenge = challengeSchema.parse(await walletRequest(`/api/wallets/${input.walletId}/recovery/options`, { backupHash }))
    const expected = await sha256Hex(utf8ToHex(JSON.stringify(["BitBudget/verified-recovery/v1", input.userId, input.walletId, record.identity.network, "dual-lineage-v1", await sha256Hex(record.context.publicPackageHex), backupHash, challenge.nonce])))
    if (expected !== challenge.digest || Date.parse(challenge.expiresAt) <= Date.now()) throw new WalletClientError("recovery-challenge-mismatch")
    const digest = hexToBytes(challenge.digest)
    const an = owned.keep(a.commit_digest_low_level(digest, 3)), cn = owned.keep(c.commit_digest_low_level(digest, 1))
    const ac = an.commitment(), cc = cn.commitment()
    const session = owned.keep(new core.WasmSigningSession(digest, 1, ac, 3, cc))
    const aSignature = owned.consume(an, () => an.sign(a, session)), cSignature = owned.consume(cn, () => cn.sign(c, session))
    core.verify_signature(pub, digest, session.aggregate(pub, 1, aSignature, 3, cSignature))
    const verified = verifiedSchema.parse(await walletRequest(`/api/wallets/${input.walletId}/recovery/verify`, { challengeId: challenge.challengeId, aCommitmentHex: bytesToHex(ac), cCommitmentHex: bytesToHex(cc), aSignatureHex: bytesToHex(aSignature), cSignatureHex: bytesToHex(cSignature) }))
    if (verified.walletId !== input.walletId) throw new WalletClientError("wallet-response-mismatch")
    await store.recordRecoveryVerification(input.walletId, record.revision, verified.recoveryVerifiedAt)
    return { walletId: input.walletId, verifiedAt: verified.recoveryVerifiedAt }
  } finally {
    for (const value of buffers) value.fill(0)
    owned.close()
    store?.close()
  }
}
