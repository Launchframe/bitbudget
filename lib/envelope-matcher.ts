import { createHash } from "crypto"
import { prisma } from "@/lib/db"

interface MatchResult {
  envelopeId: string
  confidence: number
}

/**
 * Normalize a payee name for consistent hashing/matching.
 * Strips store numbers, collapses whitespace, lowercases.
 */
export function normalizePayee(payee: string): string {
  return payee
    .trim()
    .toLowerCase()
    .replace(/\s*#\s*\d+$/, "")
    .replace(/\s+/g, " ")
}

/**
 * SHA-256 hash of a normalized payee. Used for privacy-safe lookups
 * in the PayeeEnvelopeMapping table (payee text is never stored).
 */
export function hashPayee(normalizedPayee: string): string {
  return createHash("sha256").update(normalizedPayee).digest("hex")
}

/**
 * Three-pass envelope matching strategy:
 * 1. Payee history (hashed lookup in PayeeEnvelopeMapping)
 * 2. Plaid merchant category codes (when available)
 * 3. LLM fallback
 */
export async function matchEnvelope(
  userId: string,
  payee: string,
  plaidCategoryId?: string,
): Promise<MatchResult | null> {
  const historyMatch = await matchByHistory(userId, payee)
  if (historyMatch) return historyMatch

  if (plaidCategoryId) {
    const categoryMatch = matchByCategory(userId, plaidCategoryId)
    if (categoryMatch) return categoryMatch
  }

  return matchByLLM(userId, payee)
}

/**
 * Pass 1: Look up the PayeeEnvelopeMapping table using a hashed payee.
 * This table is populated when users confirm transactions (manual or from
 * the review inbox), so accuracy improves over time.
 */
export async function matchByHistory(
  userId: string,
  payee: string,
): Promise<MatchResult | null> {
  const normalized = normalizePayee(payee)
  const hash = hashPayee(normalized)

  const mapping = await prisma.payeeEnvelopeMapping.findUnique({
    where: { userId_payeeHash: { userId, payeeHash: hash } },
    select: { envelopeId: true, count: true },
  })

  if (!mapping) return null
  return { envelopeId: mapping.envelopeId, confidence: 0.95 }
}

/**
 * Pass 2: Map Plaid merchant category codes to envelopes.
 * Placeholder — returns null until Plaid integration is built.
 */
export function matchByCategory(
  _userId: string,
  _plaidCategoryId: string,
): MatchResult | null {
  return null
}

/**
 * Pass 3: Ask GPT-4o-mini which envelope best fits the payee.
 * Capped at 0.6 confidence since LLM matching is inherently fuzzy.
 */
export async function matchByLLM(
  userId: string,
  payee: string,
): Promise<MatchResult | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const envelopes = await prisma.envelope.findMany({
    where: { userId, archived: false },
    select: { id: true, name: true },
  })

  if (envelopes.length === 0) return null

  const envelopeNames = envelopes.map((e) => e.name)

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You categorize purchases into budget envelopes. Respond ONLY with valid JSON.",
          },
          {
            role: "user",
            content: `Which budget envelope best fits a purchase from "${payee}"?\n\nAvailable envelopes: ${envelopeNames.join(", ")}\n\nRespond with: {"envelope":"<exact envelope name>","confidence":<0.0-1.0>}\nIf no envelope fits well, use {"envelope":"","confidence":0}`,
          },
        ],
        max_tokens: 100,
        temperature: 0,
      }),
    })

    if (!res.ok) return null

    const data = await res.json()
    const text = data.choices?.[0]?.message?.content?.trim() ?? ""
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0])
    if (!parsed.envelope) return null

    const matched = envelopes.find(
      (e) => e.name.toLowerCase() === parsed.envelope.toLowerCase(),
    )
    if (!matched) return null

    return { envelopeId: matched.id, confidence: Math.min(parsed.confidence ?? 0.5, 0.6) }
  } catch {
    return null
  }
}

/**
 * Upsert the payee-to-envelope mapping when a user confirms a transaction.
 * Called from the confirm pending transaction flow and manual transaction creation.
 */
export async function recordPayeeMapping(
  userId: string,
  payee: string,
  envelopeId: string,
): Promise<void> {
  const normalized = normalizePayee(payee)
  const hash = hashPayee(normalized)

  await prisma.payeeEnvelopeMapping.upsert({
    where: { userId_payeeHash: { userId, payeeHash: hash } },
    create: { userId, payeeHash: hash, envelopeId, count: 1 },
    update: { envelopeId, count: { increment: 1 } },
  })
}
