import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  getSignInMethods,
  linkEmailSignInMethod,
  linkNostrSignInMethod,
  SignInMethodError,
} from "@/lib/sign-in-methods"

function errorResponse(error: unknown) {
  if (error instanceof SignInMethodError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }
  return NextResponse.json({ error: "Failed to update sign-in methods" }, { status: 500 })
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    return NextResponse.json(await getSignInMethods(session.user.id))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 })
  }

  const data = body as Record<string, unknown>
  try {
    if (data.method === "email") {
      if (typeof data.email !== "string" || typeof data.code !== "string") {
        return NextResponse.json({ error: "Email and code are required" }, { status: 400 })
      }
      return NextResponse.json(
        await linkEmailSignInMethod({
          userId: session.user.id,
          email: data.email,
          code: data.code,
        }),
      )
    }

    if (data.method === "nostr") {
      if (typeof data.pubkey !== "string" || typeof data.event !== "string") {
        return NextResponse.json({ error: "Nostr pubkey and event are required" }, { status: 400 })
      }
      return NextResponse.json(
        await linkNostrSignInMethod({
          userId: session.user.id,
          pubkey: data.pubkey,
          event: data.event,
          expectedOrigin: req.nextUrl.origin,
          profileName: typeof data.profileName === "string" ? data.profileName : undefined,
          profileImage: typeof data.profileImage === "string" ? data.profileImage : undefined,
        }),
      )
    }

    return NextResponse.json({ error: "Unsupported sign-in method" }, { status: 400 })
  } catch (error) {
    return errorResponse(error)
  }
}
