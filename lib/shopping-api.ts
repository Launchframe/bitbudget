import { auth } from "@/lib/auth"
import { shoppingJson } from "@/lib/shopping-http"
import { shoppingErrorToResponse } from "@/lib/shopping-server"
import type { NextResponse } from "next/server"

export async function withShoppingUser(
  handler: (userId: string) => Promise<NextResponse>,
): Promise<NextResponse> {
  const session = await auth()
  if (!session?.user?.id) {
    return shoppingJson({ error: "Unauthorized" }, 401)
  }
  try {
    return await handler(session.user.id)
  } catch (err) {
    try {
      const mapped = shoppingErrorToResponse(err)
      return shoppingJson({ error: mapped.error }, mapped.status)
    } catch {
      throw err
    }
  }
}
