/** Client-safe base URL for referral links (no trailing slash). */
export function getPublicAppUrlClient(): string {
  const e = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (e) return e.replace(/\/$/, "")
  if (typeof window !== "undefined") return window.location.origin
  return ""
}
