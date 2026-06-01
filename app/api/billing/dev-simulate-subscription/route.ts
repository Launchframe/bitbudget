import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  applyDevPremiumTrialSimulation,
  isBillingDevSimulateEnabled,
} from "@/lib/billing-dev-simulate"

/**
 * Development-only: simulate a successful Premium purchase (15-day trial).
 * Returns 404 outside NODE_ENV=development.
 */
export async function POST() {
  if (!isBillingDevSimulateEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await applyDevPremiumTrialSimulation(session.user.id)
    if (!result.ok) {
      return NextResponse.json(result, { status: 200 })
    }
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: "Simulation failed" }, { status: 500 })
  }
}
