export type PageId =
  | "dashboard"
  | "runway"
  | "analytics"
  | "envelopes"
  | "envelope-allocations"
  | "envelope-detail"
  | "transactions"
  | "btc-price"
  | "researcher"
  | "funds"
  | "profile"
  | "settings"
  | "review-inbox"
  | "shopping"
  | "shopping-group"

export interface AppRoute {
  page: PageId
  envelopeId?: string
}

export function pageToHash(page: PageId, envelopeId?: string | null): string {
  if (page === "envelope-detail" && envelopeId) return `#/envelope/${envelopeId}`
  if (page === "envelope-allocations") return "#/envelopes/allocations"
  if (page === "shopping-group" && envelopeId) return `#/shopping/group/${envelopeId}`
  return `#/${page}`
}

export function hashToPage(hash: string): AppRoute {
  const path = hash.replace(/^#\/?/, "")
  if (!path || path === "/") return { page: "dashboard" }

  const envelopeMatch = path.match(/^envelope\/(.+)$/)
  if (envelopeMatch) return { page: "envelope-detail", envelopeId: envelopeMatch[1] }

  const shoppingGroupMatch = path.match(/^shopping\/group\/(.+)$/)
  if (shoppingGroupMatch) return { page: "shopping-group", envelopeId: shoppingGroupMatch[1] }

  if (path === "envelopes/allocations") return { page: "envelope-allocations" }

  if (path.startsWith("settings/")) return { page: "settings" }

  const validPages: PageId[] = ["dashboard", "runway", "analytics", "envelopes", "transactions", "btc-price", "researcher", "funds", "profile", "settings", "review-inbox", "shopping"]
  if (validPages.includes(path as PageId)) return { page: path as PageId }

  return { page: "dashboard" }
}

/** Sign-in and onboarding drop the hash; a saved invite still opens Shopping. */
export function initialRouteFromLocation(hash: string, hasPendingInvite: boolean): AppRoute {
  const path = hash.replace(/^#\/?/, "")
  if (!path && hasPendingInvite) return { page: "shopping" }
  return hashToPage(hash)
}
