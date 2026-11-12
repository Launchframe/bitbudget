import { prisma } from "./db"
import { encryptFieldForUser } from "./server-encrypt"

export const HIGH_CONFIDENCE_THRESHOLD = 0.75

/** The highest confidence value that still routes to pending (for untrusted paths). */
export const MAX_CONFIDENCE_WITHOUT_TOKEN = HIGH_CONFIDENCE_THRESHOLD - 0.01

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
  /** Money out (expense) or money in (credit). Defaults to expense. */
  type?: "expense" | "credit"
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
  const encryptedNotes =
    encryptFieldForUser(parsed.notes, user?.publicKey) ?? parsed.notes ?? null

  const ledgerType = parsed.type === "credit" ? "credit" : "expense"
  const route = routeByConfidence(parsed.confidence)

  // When the suggested envelope fails the ownership check, null it out so the
  // pending transaction doesn't carry a dangling reference to a foreign envelope.
  let effectiveSuggestedEnvelopeId = parsed.suggestedEnvelopeId ?? null

  if (route === "live" && parsed.suggestedEnvelopeId) {
    const envelope = await prisma.envelope.findFirst({
      where: { id: parsed.suggestedEnvelopeId, userId, archived: false },
    })
    if (envelope) {
      const transaction = await prisma.transaction.create({
        data: {
          userId,
          envelopeId: parsed.suggestedEnvelopeId,
          date: parsed.date,
          payee: encryptedPayee,
          amount: parsed.amount,
          type: ledgerType,
          source: parsed.source,
          notes: encryptedNotes,
          tags: parsed.tags ?? "[]",
        },
      })
      return { route: "live" as const, id: transaction.id }
    }
    // Envelope not found or does not belong to this user — downgrade to pending
    // and clear the reference so the review UI doesn't try to display a foreign envelope.
    effectiveSuggestedEnvelopeId = null
    console.warn(
      `[confidence-router] envelope ${parsed.suggestedEnvelopeId} not found for user ${userId}; routing to pending`,
    )
  }

  const pending = await prisma.pendingTransaction.create({
    data: {
      userId,
      source: parsed.source,
      payee: encryptedPayee,
      amount: parsed.amount,
      type: ledgerType,
      date: parsed.date,
      notes: encryptedNotes,
      suggestedEnvelopeId: effectiveSuggestedEnvelopeId,
      confidence: parsed.confidence,
      rawInput: parsed.rawInput,
      tags: parsed.tags,
    },
  })
  return { route: "pending" as const, id: pending.id }
}
