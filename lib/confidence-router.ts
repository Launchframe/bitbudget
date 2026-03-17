import { prisma } from "./db"
import { encryptFieldForUser } from "./server-encrypt"

const HIGH_CONFIDENCE_THRESHOLD = 0.75

export function routeByConfidence(confidence: number): "live" | "pending" {
  return confidence >= HIGH_CONFIDENCE_THRESHOLD ? "live" : "pending"
}

interface ParsedTransaction {
  payee: string
  amount: number
  date: Date
  notes?: string | null
  suggestedEnvelopeId?: string | null
  confidence: number
  source: string
  rawInput?: string | null
  tags?: string | null
}

export async function routeTransaction(
  userId: string,
  parsed: ParsedTransaction
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { publicKey: true },
  })

  const encryptedPayee =
    encryptFieldForUser(parsed.payee, user?.publicKey) ?? parsed.payee
  const encryptedNotes = encryptFieldForUser(parsed.notes, user?.publicKey)

  const route = routeByConfidence(parsed.confidence)

  if (route === "live" && parsed.suggestedEnvelopeId) {
    const transaction = await prisma.transaction.create({
      data: {
        userId,
        envelopeId: parsed.suggestedEnvelopeId,
        date: parsed.date,
        payee: encryptedPayee,
        amount: parsed.amount,
        type: "expense",
        source: parsed.source,
        notes: encryptedNotes,
        tags: parsed.tags ?? "[]",
      },
    })
    return { route: "live" as const, id: transaction.id }
  }

  const pending = await prisma.pendingTransaction.create({
    data: {
      userId,
      source: parsed.source,
      payee: encryptedPayee,
      amount: parsed.amount,
      date: parsed.date,
      notes: encryptedNotes,
      suggestedEnvelopeId: parsed.suggestedEnvelopeId,
      confidence: parsed.confidence,
      rawInput: parsed.rawInput,
      tags: parsed.tags,
    },
  })
  return { route: "pending" as const, id: pending.id }
}
