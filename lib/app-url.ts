function normalizeOrigin(url: string): string {
  const trimmed = url.trim().replace(/\/$/, "")
  return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`
}

/**
 * Server-side origin for email unsubscribe and other links in outbound mail.
 * Prefers NEXTAUTH_URL; on Vercel preview uses VERCEL_URL (not production host).
 */
export function resolveEmailAppUrl(): string | null {
  const nextAuth = process.env.NEXTAUTH_URL?.trim()
  if (nextAuth) return normalizeOrigin(nextAuth)

  if (process.env.VERCEL_ENV === "production") {
    const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
    if (prod) return normalizeOrigin(prod)
  }

  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) return normalizeOrigin(vercel)

  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:3000"
  }

  return null
}

/** Base URL for referral links, QR, mailto, and Web Share (no trailing slash). */
export function getPublicAppUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, "")
  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`
  return "http://localhost:3000"
}
