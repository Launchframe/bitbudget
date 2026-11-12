import { uint8ToHex } from "@/lib/crypto"
import {
  custodyText, exactObject, parseDeviceShareEnvelope, parseWalletPublicContext, walletPublicContext,
  type DeviceShareEnvelope, type WalletPublicContext,
} from "@/lib/wallet/client-custody"
import { parseRecoveryPackage, type RecoveryPackage } from "@/lib/wallet/recovery-package"
import { parseCreationDraft, type SealedCreationDraft } from "@/lib/wallet/creation-draft"
import { parseWalletWatchEnvelope, type WalletWatchEnvelope } from "@/lib/wallet/watch-custody"
import { BITCOIN_LINEAGES, createWalletIdentity, type WalletIdentity } from "@/lib/wallet/types"

const DATABASE_VERSION = 1
const STORE = "wallets"
const MAX_NEXT_INDEX = 0x80000000

export interface WalletCustodyEnvelopes {
  deviceShare: DeviceShareEnvelope | null
  recoveryShare: RecoveryPackage
  optionalDeviceExport: RecoveryPackage | null
}

export interface StoredWalletCustody {
  version: 1
  revision: number
  identity: WalletIdentity
  context: WalletPublicContext
  envelopes: WalletCustodyEnvelopes
  nextReceiveIndex: number
  nextChangeIndex: number
  pendingCreation: SealedCreationDraft | null
  encryptedName: string | null
  recoveryVerifiedAt: string | null
  watchEnvelope: WalletWatchEnvelope | null
}

export interface AddressIndexReservation {
  walletId: string
  branch: "receive" | "change"
  startIndex: number
  count: number
  nextIndex: number
  revision: number
}

function parseEnvelopes(value: unknown, context: WalletPublicContext): WalletCustodyEnvelopes {
  exactObject(value, ["deviceShare", "recoveryShare", "optionalDeviceExport"])
  const deviceShare = value.deviceShare === null ? null : parseDeviceShareEnvelope(value.deviceShare)
  const recoveryShare = parseRecoveryPackage(value.recoveryShare)
  const optionalDeviceExport = value.optionalDeviceExport === null ? null : parseRecoveryPackage(value.optionalDeviceExport)
  if (recoveryShare.context.role !== "C" || (optionalDeviceExport && optionalDeviceExport.context.role !== "A")) {
    throw new Error("Required recovery C or optional export A has the wrong role")
  }
  for (const envelope of [deviceShare, recoveryShare, optionalDeviceExport]) {
    if (envelope && JSON.stringify(walletPublicContext(envelope.context)) !== JSON.stringify(context)) {
      throw new Error("Wallet envelope context mismatch")
    }
  }
  if (deviceShare && optionalDeviceExport && deviceShare.context.participantId !== optionalDeviceExport.context.participantId) {
    throw new Error("Device share participant mismatch")
  }
  if ([deviceShare, optionalDeviceExport].some(envelope => envelope?.context.participantId === recoveryShare.context.participantId)) {
    throw new Error("Recovery and device participants must differ")
  }
  return { deviceShare, recoveryShare, optionalDeviceExport }
}

function parseStoredWallet(value: unknown, accountId: string, walletId: string): StoredWalletCustody {
  const metadata = ["pendingCreation", "encryptedName", "recoveryVerifiedAt", "watchEnvelope"].filter(key => value && typeof value === "object" && Object.hasOwn(value, key))
  exactObject(value, ["version", "revision", "identity", "context", "envelopes", "nextReceiveIndex", "nextChangeIndex", ...metadata])
  const pendingCreation = value.pendingCreation == null ? null : parseCreationDraft(value.pendingCreation)
  const encryptedName = value.encryptedName == null ? null : value.encryptedName
  if (encryptedName !== null && (typeof encryptedName !== "string" || encryptedName.length > 4096 || !/^[0-9a-f]{24}:(?:[0-9a-f]{2}){16,}$/.test(encryptedName))) throw new Error("Invalid encrypted wallet name")
  const recoveryVerifiedAt = value.recoveryVerifiedAt == null ? null : value.recoveryVerifiedAt
  if (recoveryVerifiedAt !== null && (typeof recoveryVerifiedAt !== "string" || !Number.isFinite(Date.parse(recoveryVerifiedAt)))) throw new Error("Invalid recovery verification date")
  if (value.version !== 1 || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1) {
    throw new Error("Unsupported wallet storage version")
  }
  const context = parseWalletPublicContext(value.context)
  const watchEnvelope = value.watchEnvelope == null ? null : parseWalletWatchEnvelope(value.watchEnvelope)
  if (watchEnvelope && JSON.stringify(watchEnvelope.context) !== JSON.stringify(context)) throw new Error("Wallet watch context mismatch")
  if (context.accountId !== accountId || context.walletId !== walletId) throw new Error("Wallet account mismatch")
  exactObject(value.identity, ["id", "network", "lineages"])
  if (value.identity.id !== walletId || value.identity.network !== context.network ||
      !Array.isArray(value.identity.lineages) || value.identity.lineages.length !== 2 ||
      value.identity.lineages.some((lineage, index) => lineage !== BITCOIN_LINEAGES[index])) {
    throw new Error("Invalid dual-lineage wallet identity")
  }
  for (const index of [value.nextReceiveIndex, value.nextChangeIndex]) {
    if (!Number.isSafeInteger(index) || (index as number) < 0 || (index as number) > MAX_NEXT_INDEX) {
      throw new Error("Invalid wallet derivation index")
    }
  }
  return {
    version: 1, revision: value.revision as number,
    identity: createWalletIdentity(walletId, context.network), context,
    envelopes: parseEnvelopes(value.envelopes, context),
    nextReceiveIndex: value.nextReceiveIndex as number, nextChangeIndex: value.nextChangeIndex as number,
    pendingCreation, encryptedName, recoveryVerifiedAt, watchEnvelope,
  }
}

function incrementRevision(revision: number): number {
  if (revision >= Number.MAX_SAFE_INTEGER) throw new Error("Wallet revision exhausted")
  return revision + 1
}

export interface WalletCustodyStore {
  createWallet(input: { context: WalletPublicContext; envelopes: WalletCustodyEnvelopes; pendingCreation?: SealedCreationDraft; encryptedName?: string; watchEnvelope?: WalletWatchEnvelope }): Promise<StoredWalletCustody>
  getWallet(walletId: string): Promise<StoredWalletCustody | null>
  completeCreation(walletId: string, expectedRevision: number): Promise<StoredWalletCustody>
  recordRecoveryVerification(walletId: string, expectedRevision: number, verifiedAt: string): Promise<StoredWalletCustody>
  replaceEnvelopes(walletId: string, expectedRevision: number, envelopes: WalletCustodyEnvelopes): Promise<StoredWalletCustody>
  reserveAddressIndices(walletId: string, branch: "receive" | "change", count?: number): Promise<AddressIndexReservation>
  close(): void
}

export async function walletCustodyDatabaseName(accountId: string): Promise<string> {
  custodyText(accountId)
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(accountId))
  return `bitbudget-wallet-custody-v1-${uint8ToHex(new Uint8Array(digest))}`
}

export async function openWalletCustodyStore(accountId: string, factory: IDBFactory = globalThis.indexedDB): Promise<WalletCustodyStore> {
  custodyText(accountId)
  if (!factory) throw new Error("IndexedDB is unavailable")
  const name = await walletCustodyDatabaseName(accountId)
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, DATABASE_VERSION)
    let failed = false
    request.onupgradeneeded = event => {
      if (event.oldVersion !== 0) {
        request.transaction?.abort()
        return
      }
      request.result.createObjectStore(STORE)
    }
    request.onblocked = () => {
      failed = true
      reject(new Error("Wallet storage upgrade blocked"))
    }
    request.onerror = () => reject(new Error("Unable to open wallet storage"))
    request.onsuccess = () => {
      if (failed) request.result.close()
      else resolve(request.result)
    }
  })
  db.onversionchange = () => db.close()

  function transaction<T>(walletId: string, mode: IDBTransactionMode, run: (
    store: IDBObjectStore, key: IDBValidKey, current: StoredWalletCustody | null,
  ) => T): Promise<T> {
    custodyText(walletId)
    return new Promise((resolve, reject) => {
      const tx = mode === "readwrite"
        ? db.transaction(STORE, mode, { durability: "strict" })
        : db.transaction(STORE, mode)
      const store = tx.objectStore(STORE)
      const key = [accountId, walletId]
      let result: T
      let failure: Error | undefined
      tx.oncomplete = () => resolve(result)
      tx.onabort = () => reject(failure ?? new Error("Wallet storage transaction aborted"))
      tx.onerror = () => { failure ??= new Error("Wallet storage transaction failed") }
      const request = store.get(key)
      request.onsuccess = () => {
        try {
          const current = request.result === undefined ? null : parseStoredWallet(request.result, accountId, walletId)
          result = run(store, key, current)
        } catch (error) {
          failure = error instanceof Error ? error : new Error("Invalid wallet storage operation")
          tx.abort()
        }
      }
    })
  }

  return {
    async createWallet(input) {
      const context = parseWalletPublicContext(input.context)
      if (context.accountId !== accountId) throw new Error("Wallet account mismatch")
      const envelopes = parseEnvelopes(input.envelopes, context)
      const pendingCreation = input.pendingCreation ? parseCreationDraft(input.pendingCreation) : null
      const encryptedName = input.encryptedName ?? null
      const watchEnvelope = input.watchEnvelope ? parseWalletWatchEnvelope(input.watchEnvelope) : null
      return transaction(context.walletId, "readwrite", (store, key, current) => {
        if (current) throw new Error("Wallet already exists; custody cannot be reset")
        const record: StoredWalletCustody = {
          version: 1, revision: 1, identity: createWalletIdentity(context.walletId, context.network),
          context, envelopes, nextReceiveIndex: 0, nextChangeIndex: 0,
          pendingCreation, encryptedName, recoveryVerifiedAt: null, watchEnvelope,
        }
        parseStoredWallet(record, accountId, context.walletId)
        store.add(record, key)
        return record
      })
    },
    async getWallet(walletId) {
      return transaction(walletId, "readonly", (_store, _key, current) => current)
    },
    async completeCreation(walletId, expectedRevision) {
      return transaction(walletId, "readwrite", (store, key, current) => {
        if (!current || current.revision !== expectedRevision) throw new Error("Wallet revision conflict")
        const updated = { ...current, pendingCreation: null, revision: incrementRevision(current.revision) }
        store.put(updated, key)
        return updated
      })
    },
    async recordRecoveryVerification(walletId, expectedRevision, verifiedAt) {
      if (!Number.isFinite(Date.parse(verifiedAt))) throw new Error("Invalid recovery verification date")
      return transaction(walletId, "readwrite", (store, key, current) => {
        if (!current || current.pendingCreation || current.revision !== expectedRevision) throw new Error("Wallet revision conflict")
        const updated = { ...current, recoveryVerifiedAt: new Date(verifiedAt).toISOString(), revision: incrementRevision(current.revision) }
        store.put(updated, key)
        return updated
      })
    },
    async replaceEnvelopes(walletId, expectedRevision, envelopes) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error("Invalid wallet revision")
      const snapshot = structuredClone(envelopes)
      return transaction(walletId, "readwrite", (store, key, current) => {
        if (!current) throw new Error("Wallet not found")
        if (current.revision !== expectedRevision) throw new Error("Wallet revision conflict")
        const replacement = parseEnvelopes(snapshot, current.context)
        if (replacement.recoveryShare.context.participantId !== current.envelopes.recoveryShare.context.participantId) {
          throw new Error("Recovery participant cannot change")
        }
        const oldA = current.envelopes.deviceShare ?? current.envelopes.optionalDeviceExport
        const newA = replacement.deviceShare ?? replacement.optionalDeviceExport
        if (oldA && (!newA || oldA.context.participantId !== newA.context.participantId)) {
          throw new Error("Device participant cannot change or be removed")
        }
        const updated = { ...current, envelopes: replacement, revision: incrementRevision(current.revision) }
        store.put(updated, key)
        return updated
      })
    },
    async reserveAddressIndices(walletId, branch, count = 1) {
      if (branch !== "receive" && branch !== "change") throw new Error("Invalid derivation branch")
      if (!Number.isSafeInteger(count) || count < 1 || count > 10_000) throw new Error("Invalid reservation count")
      return transaction(walletId, "readwrite", (store, key, current) => {
        if (!current) throw new Error("Wallet not found")
        const field = branch === "receive" ? "nextReceiveIndex" : "nextChangeIndex"
        const startIndex = current[field]
        const nextIndex = startIndex + count
        if (nextIndex > MAX_NEXT_INDEX) throw new Error("Wallet derivation indices exhausted")
        const revision = incrementRevision(current.revision)
        store.put({ ...current, [field]: nextIndex, revision }, key)
        return { walletId, branch, startIndex, count, nextIndex, revision }
      })
    },
    close() { db.close() },
  }
}
