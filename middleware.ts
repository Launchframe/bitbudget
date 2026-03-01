import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isLoggedIn = !!req.auth

  const isAuthPage = pathname.startsWith("/auth")
  const isApiRoute = pathname.startsWith("/api")
  const isPublicAsset = pathname.startsWith("/_next") || pathname.includes(".")

  if (isApiRoute || isPublicAsset) return NextResponse.next()

  if (!isLoggedIn && !isAuthPage) {
    return NextResponse.redirect(new URL("/auth", req.url))
  }

  if (isLoggedIn && isAuthPage) {
    return NextResponse.redirect(new URL("/", req.url))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon-.*|apple-icon|placeholder-logo).*)"],
}
