import { NextResponse } from "next/server"

/** Liveness probe for Docker / reverse proxies (no auth). */
export async function GET() {
  return NextResponse.json({ ok: true })
}
