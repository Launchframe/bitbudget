import { NextResponse } from "next/server"
import { seedTransactionCrudE2e } from "@/e2e/seed-transaction-crud-e2e"

export async function POST() {
  if (process.env.E2E_TEST !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  await seedTransactionCrudE2e()
  return NextResponse.json({ ok: true })
}
