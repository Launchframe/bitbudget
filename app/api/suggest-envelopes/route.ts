import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { normalizePayee, hashPayee } from "@/lib/envelope-matcher"

const MAX_PAYEES = 500

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }
  const { payees } = body as { payees?: unknown }

  if (!Array.isArray(payees) || payees.length === 0) {
    return NextResponse.json({ suggestions: {} })
  }
  if (payees.length > MAX_PAYEES) {
    return NextResponse.json({ error: `Too many payees (max ${MAX_PAYEES})` }, { status: 400 })
  }
  if (!payees.every((p) => typeof p === "string")) {
    return NextResponse.json({ error: "payees must be strings" }, { status: 400 })
  }

  const userId = session.user.id

  // Build normalized → hash map, deduplicated
  const normalizedToHash = new Map<string, string>()
  for (const payee of payees as string[]) {
    const norm = normalizePayee(payee)
    if (norm && !normalizedToHash.has(norm)) {
      normalizedToHash.set(norm, hashPayee(norm))
    }
  }

  const hashes = Array.from(normalizedToHash.values())
  if (hashes.length === 0) return NextResponse.json({ suggestions: {} })

  const rows = await prisma.payeeEnvelopeMapping.findMany({
    where: { userId, payeeHash: { in: hashes } },
    select: { payeeHash: true, envelopeId: true },
  })

  // Build reverse map: hash → envelopeId
  const hashToEnvelope = new Map(rows.map((r) => [r.payeeHash, r.envelopeId]))

  // Build result: normalizedPayee → envelopeId
  const suggestions: Record<string, string> = {}
  for (const [norm, hash] of normalizedToHash) {
    const envelopeId = hashToEnvelope.get(hash)
    if (envelopeId) suggestions[norm] = envelopeId
  }

  return NextResponse.json({ suggestions })
}
