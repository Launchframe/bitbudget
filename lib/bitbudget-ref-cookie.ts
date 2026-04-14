/**
 * Parse the `bitbudget_ref` cookie set by `/ref/[code]`.
 * Value is `code` or `code:shareMethod` (URL-encoded).
 */
export function parseBitbudgetRefCookie(documentCookie: string): { code: string; shareMethod: string } | null {
  try {
    const m = documentCookie.match(/(?:^|; )bitbudget_ref=([^;]*)/)
    if (!m?.[1]) return null
    const decoded = decodeURIComponent(m[1]!)
    const col = decoded.indexOf(":")
    const code = (col === -1 ? decoded : decoded.slice(0, col)).trim()
    const shareMethod = col === -1 ? "link" : decoded.slice(col + 1).trim() || "direct"
    if (!code) return null
    return { code, shareMethod }
  } catch {
    return null
  }
}
