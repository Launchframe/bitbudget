import { deriveWalletAddress } from "@/lib/wallet/derivation"
import { openWalletWatchSeed } from "@/lib/wallet/watch-custody"
import type { StoredWalletCustody } from "@/lib/wallet/wallet-idb"
import type { AddressChain } from "@/lib/wallets/xpub-cache"
import type { WatchSource } from "@/lib/wallets/xpub-sync"
import type { CustodyLedgerSettings } from "@/lib/wallet/ledger-settings"

/**
 * A BitBudget custody wallet exposed to the shared xpub sync engine.
 *
 * Address derivation needs the wallet's watch seed, which is sealed in
 * IndexedDB under the account privacy key. The seed is held only inside this
 * closure for the lifetime of one sync pass and zeroed by `dispose()`.
 * Nothing here can sign: the seed only tweaks the public group key.
 */
export interface CustodyWatchSource extends WatchSource {
  /** Zero the in-memory watch seed. Safe to call more than once. */
  dispose(): void
}

export const CUSTODY_WATCH_ID_PREFIX = "custody:"

/** Local cache id for a custody wallet, namespaced so it can never collide with an xpub wallet id. */
export function custodyWatchId(walletId: string): string {
  return `${CUSTODY_WATCH_ID_PREFIX}${walletId}`
}

export function isCustodyWatchId(id: string): boolean {
  return id.startsWith(CUSTODY_WATCH_ID_PREFIX)
}

function chainToBranch(chain: AddressChain): "receive" | "change" {
  return chain === 0 ? "receive" : "change"
}

export interface CustodyAddress {
  branch: "receive" | "change"
  index: number
  address: string
  scriptPubKeyHex: string
}

/**
 * Derive one or more addresses for a custody wallet, opening the sealed watch
 * seed only for the duration of the call. Used by the Receive tab and by the
 * send flow (change output). Never returns or retains the seed.
 */
export async function deriveCustodyAddresses(input: {
  record: StoredWalletCustody
  privacyKey: Uint8Array
  branch: "receive" | "change"
  startIndex: number
  count: number
}): Promise<CustodyAddress[]> {
  if (!input.record.watchEnvelope) throw new Error("This wallet has no watch data on this device yet.")
  if (!Number.isSafeInteger(input.count) || input.count < 1 || input.count > 1000) throw new Error("Invalid address count")
  const seed = await openWalletWatchSeed(input.record.watchEnvelope, input.privacyKey, input.record.context)
  try {
    const out: CustodyAddress[] = []
    for (let i = 0; i < input.count; i++) {
      const derived = deriveWalletAddress(seed, input.record.context, input.branch, input.startIndex + i)
      out.push({ branch: input.branch, index: derived.index, address: derived.address, scriptPubKeyHex: derived.scriptPubKeyHex })
    }
    return out
  } finally {
    seed.fill(0)
  }
}

export async function openCustodyWatchSource(input: {
  record: StoredWalletCustody
  privacyKey: Uint8Array
  nickname: string
  settings: CustodyLedgerSettings
}): Promise<CustodyWatchSource> {
  const { record, settings } = input
  if (!record.watchEnvelope) throw new Error("This wallet has no watch data on this device yet.")
  const seed = await openWalletWatchSeed(record.watchEnvelope, input.privacyKey, record.context)
  let disposed = false
  return {
    id: custodyWatchId(record.identity.id),
    nickname: input.nickname,
    gapLimit: settings.gapLimit,
    defaultEnvelopeId: settings.defaultEnvelopeId,
    receiveMode: settings.receiveMode,
    explorerBaseUrl: settings.explorerBaseUrl,
    ledgerSource: "onchain_wallet",
    deriveAddress(chain, index) {
      if (disposed) throw new Error("Wallet watch source was already closed.")
      return deriveWalletAddress(seed, record.context, chainToBranch(chain), index).address
    },
    dispose() {
      disposed = true
      seed.fill(0)
    },
  }
}
