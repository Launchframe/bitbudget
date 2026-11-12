export const NOSTR_PROFILE_NAME_MAX_LENGTH = 80
export const NOSTR_PROFILE_IMAGE_MAX_LENGTH = 2048

export interface NostrProfileFields {
  name?: string | null
  image?: string | null
}

export function isNostrPlaceholderName(name: string | null | undefined): boolean {
  return typeof name === "string" && name.startsWith("nostr:")
}

export function needsNostrProfileSync(user: {
  name: string | null
  image: string | null
  nostrPubkey: string | null
}): boolean {
  if (!user.nostrPubkey?.trim()) return false
  if (isNostrPlaceholderName(user.name)) return true
  if (!user.image?.trim()) return true
  return false
}

export function sanitizeNostrProfileName(profileName?: string | null): string | undefined {
  const name = profileName?.trim()
  return name ? name.slice(0, NOSTR_PROFILE_NAME_MAX_LENGTH) : undefined
}

export function sanitizeNostrProfileImage(profileImage?: string | null): string | undefined {
  const image = profileImage?.trim()
  if (!image || image.length > NOSTR_PROFILE_IMAGE_MAX_LENGTH) return undefined
  try {
    const url = new URL(image)
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined
  } catch {
    return undefined
  }
}

/** Apply relay metadata to an existing user row (login + background sync). */
export function computeNostrProfileUpdates(
  current: { name: string | null; image: string | null },
  fetched: NostrProfileFields,
): { name?: string; image?: string } | null {
  const updates: { name?: string; image?: string } = {}
  const name = sanitizeNostrProfileName(fetched.name)
  const image = sanitizeNostrProfileImage(fetched.image)

  if (name && isNostrPlaceholderName(current.name)) {
    updates.name = name
  }
  if (image && current.image !== image) {
    updates.image = image
  }

  return Object.keys(updates).length > 0 ? updates : null
}
