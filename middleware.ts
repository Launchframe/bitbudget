import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isLoggedIn = !!req.auth

  const isAuthPage = pathname.startsWith("/auth")
  const firstSegment = pathname.split("/").filter(Boolean)[0] ?? ""
  const reservedRootSegments = new Set([
    "auth",
    "welcome",
    "landing",
    "onboarding",
    "admin",
    "whitepapers",
    "ref",
  ])
  const isPublicLanding =
    pathname.startsWith("/landing") ||
    pathname.startsWith("/welcome") ||
    pathname.startsWith("/ref")
  const isPublicOfferSlug =
    firstSegment.length > 0 && !reservedRootSegments.has(firstSegment) && pathname.split("/").filter(Boolean).length === 1
  const isApiRoute = pathname.startsWith("/api")
  const isPublicAsset = pathname.startsWith("/_next") || pathname.includes(".")

  if (isApiRoute || isPublicAsset) return NextResponse.next()

  if (isPublicLanding || isPublicOfferSlug) {
    // Logged-in users may still open /welcome or /landing (e.g. re-read marketing copy).
    // Single-segment paths not in reserved set may be offer codes (validated in app/[slug]).
    return NextResponse.next()
  }

  if (!isLoggedIn && !isAuthPage) {
    const isReturningUser = req.cookies.has("bitbudget_visited")
    return NextResponse.redirect(new URL(isReturningUser ? "/auth" : "/welcome", req.url))
  }

  if (isLoggedIn && isAuthPage) {
    return NextResponse.redirect(new URL("/", req.url))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon-.*|apple-icon|placeholder-logo).*)"],
}
