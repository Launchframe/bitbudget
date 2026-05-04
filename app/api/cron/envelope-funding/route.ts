import { NextRequest, NextResponse } from "next/server"
import { processAllEnvelopeFunding } from "@/lib/envelope-funding"

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const created = await processAllEnvelopeFunding()
    return NextResponse.json({ processed: created })
  } catch (err) {
    console.error("[cron/envelope-funding] Error:", err)
    return NextResponse.json(
      { error: "Processing failed", message: String(err) },
      { status: 500 },
    )
  }
}
