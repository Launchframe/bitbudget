import type { NextRequest } from "next/server"

/** Options for the `bitbudget_ref` invite cookie (Route Handlers only). */
export function bitbudgetRefCookieOptions(req: Request | NextRequest) {
  const href = "nextUrl" in req ? req.nextUrl.href : req.url
  return {
    path: "/" as const,
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax" as const,
    httpOnly: false,
    secure: new URL(href).protocol === "https:",
  }
}
