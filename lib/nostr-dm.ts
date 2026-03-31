import { decode } from "nostr-tools/nip19"
import { finalizeEvent } from "nostr-tools"
import { encrypt } from "nostr-tools/nip04"
import { SimplePool } from "nostr-tools/pool"

const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
]

function parseServiceSecretKey(raw: string | undefined): Uint8Array | null {
  if (!raw?.trim()) return null
  const t = raw.trim()
  if (t.startsWith("nsec")) {
    const d = decode(t)
    if (d.type !== "nsec") return null
    return d.data
  }
  if (/^[0-9a-fA-F]{64}$/.test(t)) {
    return Uint8Array.from(Buffer.from(t, "hex"))
  }
  return null
}

function relayList(): string[] {
  const env = process.env.BITBUDGET_NOSTR_RELAYS?.trim()
  if (!env) return DEFAULT_RELAYS
  return env
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean)
}

/**
 * Encrypt and publish a NIP-04 DM (kind 4). Best-effort; swallows errors after logging.
 */
export async function sendNostrDm(recipientPubkeyHex: string, message: string): Promise<boolean> {
  const sk = parseServiceSecretKey(process.env.BITBUDGET_NOSTR_NSEC)
  if (!sk) {
    console.warn("[nostr-dm] BITBUDGET_NOSTR_NSEC not configured")
    return false
  }
  const pk = recipientPubkeyHex.trim()
  if (!/^[0-9a-fA-F]{64}$/.test(pk)) {
    console.warn("[nostr-dm] invalid recipient pubkey")
    return false
  }

  try {
    const content = encrypt(sk, pk, message)
    const event = finalizeEvent(
      {
        kind: 4,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", pk]],
        content,
      },
      sk,
    )
    const pool = new SimplePool()
    const relays = relayList()
    const pubs = pool.publish(relays, event)
    await Promise.any(pubs)
    pool.close(relays)
    return true
  } catch (e) {
    console.error("[nostr-dm] publish failed:", e)
    return false
  }
}

export async function sendReferralAcceptedDm(recipientPubkey: string, refereeName: string): Promise<void> {
  await sendNostrDm(
    recipientPubkey,
    `Referral accepted: ${refereeName} joined BitBudget with your link. You'll earn bonus premium when they connect their bank.`,
  )
}

export async function sendReferralActivatedDm(
  recipientPubkey: string,
  refereeName: string,
  rewardMonths: number,
  newExpiryDate: string,
): Promise<void> {
  await sendNostrDm(
    recipientPubkey,
    `Referral activated: ${refereeName} connected their bank. You earned ${rewardMonths} month(s) of premium through ${newExpiryDate}.`,
  )
}

export async function sendGratisExpiringDm(
  recipientPubkey: string,
  expiryDate: string,
  daysRemaining: number,
): Promise<void> {
  await sendNostrDm(
    recipientPubkey,
    `Your BitBudget referral bonus premium ends in ${daysRemaining} day(s) (on ${expiryDate}).`,
  )
}

export async function sendGratisExpiredDm(recipientPubkey: string): Promise<void> {
  await sendNostrDm(recipientPubkey, "Your BitBudget referral bonus premium period has ended.")
}

export async function sendTrialEndingDm(
  recipientPubkey: string,
  expiryDate: string,
  daysRemaining: number,
): Promise<void> {
  await sendNostrDm(
    recipientPubkey,
    `Your BitBudget premium trial ends in ${daysRemaining} day(s) (on ${expiryDate}).`,
  )
}

export async function sendTrialExpiredDm(recipientPubkey: string): Promise<void> {
  await sendNostrDm(recipientPubkey, "Your BitBudget premium trial has ended.")
}

export async function sendAdminDigestDm(recipientPubkey: string, text: string): Promise<void> {
  await sendNostrDm(recipientPubkey, text)
}
