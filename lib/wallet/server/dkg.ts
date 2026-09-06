import { createHash, timingSafeEqual } from "node:crypto"
import { testNetworkSchema, WalletError } from "@/lib/wallet/server/config"
import { loadWalletMpc } from "@/lib/wallet/server/mpc"
import { unwrapCosignerShare, wrapCosignerShare } from "@/lib/wallet/server/encryption"

export interface DkgBinding {
  userId: string
  walletId: string
  network: string
}

function validBinding(binding: DkgBinding) {
  if (!binding.userId || !binding.walletId || !testNetworkSchema.safeParse(binding.network).success) {
    throw new WalletError(400, "invalid-binding")
  }
}

function contribution(bytes: Uint8Array) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > 2048) {
    throw new WalletError(400, "invalid-dkg-contribution")
  }
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function beginCosignerDkg(binding: DkgBinding, aBroadcast: Uint8Array, cBroadcast: Uint8Array) {
  validBinding(binding)
  contribution(aBroadcast)
  contribution(cBroadcast)
  const core = await loadWalletMpc()
  const first = new core.WasmDkgRound1(2)
  const broadcast = first.broadcast()
  const second = first.advance(1, aBroadcast, 3, cBroadcast)
  const toA = second.take_message(1)
  const toC = second.take_message(3)
  const transcriptHash = Buffer.from(second.broadcast_digest()).toString("hex")
  const secret = second.export_secret_state()
  try {
    const encryptedState = wrapCosignerShare(secret, { ...binding, publicPackageHash: transcriptHash, purpose: "dkg-state" })
    return { broadcast, toA, toC, transcriptHash, encryptedState }
  } catch (error) {
    toA.fill(0)
    toC.fill(0)
    throw error
  } finally {
    secret.fill(0)
  }
}

export async function finishCosignerDkg(
  binding: DkgBinding,
  encryptedState: Uint8Array,
  transcriptHash: string,
  aContribution: Uint8Array,
  cContribution: Uint8Array,
  expectedPublicPackage: Uint8Array,
) {
  validBinding(binding)
  contribution(aContribution)
  contribution(cContribution)
  if (!/^[0-9a-f]{64}$/.test(transcriptHash) || !expectedPublicPackage.length || expectedPublicPackage.length > 8192) {
    throw new WalletError(400, "invalid-dkg-context")
  }
  const core = await loadWalletMpc()
  const secretState = unwrapCosignerShare(encryptedState, { ...binding, publicPackageHash: transcriptHash, purpose: "dkg-state" })
  let second
  try {
    second = core.WasmDkgRound2.restore_secret_state(2, secretState)
  } finally {
    secretState.fill(0)
  }
  if (!equal(second.broadcast_digest(), Buffer.from(transcriptHash, "hex"))) {
    second.free()
    throw new WalletError(400, "dkg-transcript-mismatch")
  }
  const share = second.finish(1, aContribution, 3, cContribution)
  let secret: Uint8Array | undefined
  try {
    const publicPackage = share.public_package()
    if (!equal(publicPackage, expectedPublicPackage)) throw new WalletError(400, "dkg-public-package-mismatch")
    const publicPackageHash = createHash("sha256").update(publicPackage).digest("hex")
    secret = share.export_secret_share()
    const encryptedShare = wrapCosignerShare(secret, { ...binding, publicPackageHash, purpose: "share" })
    return { publicPackage, publicPackageHash, encryptedShare, outputKey: share.output_key() }
  } finally {
    secret?.fill(0)
    share.free()
  }
}
