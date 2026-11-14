// @vitest-environment node
import { webcrypto } from "node:crypto"
import { beforeAll, describe, expect, it } from "vitest"
import {
  decryptFieldAsymmetric,
  encryptFieldAsymmetric,
  generateKeyPairFromSeed,
} from "../crypto"
import {
  MAX_JOURNAL_BODY_LENGTH,
  parseRunwayJournalCreate,
  parseRunwayJournalUpdate,
  validateEncryptedBody,
  validateEntryId,
  validateEnvelopeId,
  validateMonthKey,
} from "../runway-journal"

beforeAll(() => {
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto as unknown as Crypto
  }
})

function sealedNote(plaintext: string): { body: string; secretKey: Uint8Array } {
  const seed = new Uint8Array(32)
  for (let i = 0; i < seed.length; i++) seed[i] = i + 1
  const { publicKey, secretKey } = generateKeyPairFromSeed(seed)
  return { body: encryptFieldAsymmetric(plaintext, publicKey), secretKey }
}

function expectOk<T>(
  result: { ok: true; value: T } | { ok: false; error: string },
): T {
  if (!result.ok) {
    throw new Error(`expected ok, got error: ${result.error}`)
  }
  return result.value
}

describe("validateMonthKey", () => {
  it("accepts a valid YYYY-MM key", () => {
    expect(expectOk(validateMonthKey("2026-03"))).toBe("2026-03")
    expect(expectOk(validateMonthKey("2026-01"))).toBe("2026-01")
    expect(expectOk(validateMonthKey("2026-12"))).toBe("2026-12")
  })

  it("rejects non-strings and malformed shapes", () => {
    expect(validateMonthKey(202603).ok).toBe(false)
    expect(validateMonthKey("2026-3").ok).toBe(false)
    expect(validateMonthKey("2026/03").ok).toBe(false)
    expect(validateMonthKey("nope").ok).toBe(false)
    expect(validateMonthKey(null).ok).toBe(false)
    expect(validateMonthKey(undefined).ok).toBe(false)
  })

  it("rejects months outside 01–12 even when regex-shaped", () => {
    expect(validateMonthKey("2026-00").ok).toBe(false)
    expect(validateMonthKey("2026-13").ok).toBe(false)
    expect(validateMonthKey("2026-99").ok).toBe(false)
  })
})

describe("validateEncryptedBody", () => {
  it("accepts a sealed box and stores it unchanged", () => {
    const plaintext = "I overspent because friends were in town"
    const { body, secretKey } = sealedNote(plaintext)
    const stored = expectOk(validateEncryptedBody(body))
    expect(stored).toBe(body)
    expect(stored).not.toContain(plaintext)
    expect(decryptFieldAsymmetric(stored, secretKey)).toBe(plaintext)
  })

  it("rejects plaintext notes and does not echo them", () => {
    const note = "I overspent because friends were in town"
    const result = validateEncryptedBody(note)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).not.toContain("overspent")
      expect(result.error.toLowerCase()).not.toContain("cipher")
    }
    expect(validateEncryptedBody("cipher==").ok).toBe(false)
    expect(validateEncryptedBody("abc123==").ok).toBe(false)
    expect(validateEncryptedBody("c").ok).toBe(false)
  })

  it("rejects a sealed box with surrounding whitespace instead of trimming it", () => {
    const { body } = sealedNote("note")
    expect(validateEncryptedBody(` ${body}`).ok).toBe(false)
    expect(validateEncryptedBody(`${body}\n`).ok).toBe(false)
  })

  it("rejects non-strings", () => {
    expect(validateEncryptedBody(123).ok).toBe(false)
    expect(validateEncryptedBody(null).ok).toBe(false)
    expect(validateEncryptedBody({}).ok).toBe(false)
  })

  it("rejects empty and whitespace-only bodies", () => {
    expect(validateEncryptedBody("").ok).toBe(false)
    expect(validateEncryptedBody("   ").ok).toBe(false)
    expect(validateEncryptedBody("\n\t").ok).toBe(false)
  })

  it("rejects bodies over the max length but accepts a shape-valid boundary", () => {
    const atMax = "A".repeat(MAX_JOURNAL_BODY_LENGTH)
    expect(expectOk(validateEncryptedBody(atMax))).toBe(atMax)
    expect(validateEncryptedBody("A".repeat(MAX_JOURNAL_BODY_LENGTH + 4)).ok).toBe(
      false,
    )
    const huge = sealedNote("x".repeat(50_000))
    expect(huge.body.length).toBeGreaterThan(MAX_JOURNAL_BODY_LENGTH)
    expect(validateEncryptedBody(huge.body).ok).toBe(false)
  })
})

describe("validateEnvelopeId", () => {
  it("treats empty / null / undefined as no envelope", () => {
    expect(expectOk(validateEnvelopeId(""))).toBeNull()
    expect(expectOk(validateEnvelopeId(null))).toBeNull()
    expect(expectOk(validateEnvelopeId(undefined))).toBeNull()
  })

  it("accepts a plausible id", () => {
    expect(expectOk(validateEnvelopeId("clx123abc"))).toBe("clx123abc")
  })

  it("rejects whitespace-only, non-string, and over-long ids", () => {
    expect(validateEnvelopeId("   ").ok).toBe(false)
    expect(validateEnvelopeId(123).ok).toBe(false)
    expect(validateEnvelopeId("x".repeat(65)).ok).toBe(false)
  })
})

describe("validateEntryId", () => {
  it("accepts a plausible id and rejects empties / over-long", () => {
    expect(expectOk(validateEntryId("entry_1"))).toBe("entry_1")
    expect(validateEntryId("").ok).toBe(false)
    expect(validateEntryId("   ").ok).toBe(false)
    expect(validateEntryId(null).ok).toBe(false)
    expect(validateEntryId("x".repeat(65)).ok).toBe(false)
  })
})

describe("parseRunwayJournalCreate", () => {
  it("parses a full valid body with an envelope", () => {
    const { body } = sealedNote("note")
    const value = expectOk(
      parseRunwayJournalCreate({
        monthKey: "2026-03",
        encryptedBody: body,
        envelopeId: "env_1",
      }),
    )
    expect(value).toEqual({
      monthKey: "2026-03",
      encryptedBody: body,
      envelopeId: "env_1",
    })
  })

  it("defaults envelopeId to null when omitted or empty", () => {
    const { body } = sealedNote("note")
    expect(
      expectOk(
        parseRunwayJournalCreate({ monthKey: "2026-03", encryptedBody: body }),
      ).envelopeId,
    ).toBeNull()
    expect(
      expectOk(
        parseRunwayJournalCreate({
          monthKey: "2026-03",
          encryptedBody: body,
          envelopeId: "",
        }),
      ).envelopeId,
    ).toBeNull()
  })

  it("rejects non-object bodies", () => {
    expect(parseRunwayJournalCreate(null).ok).toBe(false)
    expect(parseRunwayJournalCreate([]).ok).toBe(false)
    expect(parseRunwayJournalCreate("x").ok).toBe(false)
  })

  it("propagates field errors (monthKey, body, envelopeId)", () => {
    const { body } = sealedNote("note")
    expect(
      parseRunwayJournalCreate({ monthKey: "2026-13", encryptedBody: body }).ok,
    ).toBe(false)
    expect(
      parseRunwayJournalCreate({ monthKey: "2026-03", encryptedBody: "" }).ok,
    ).toBe(false)
    expect(
      parseRunwayJournalCreate({
        monthKey: "2026-03",
        encryptedBody: "I overspent on dining",
      }).ok,
    ).toBe(false)
    expect(
      parseRunwayJournalCreate({
        monthKey: "2026-03",
        encryptedBody: body,
        envelopeId: "   ",
      }).ok,
    ).toBe(false)
  })
})

describe("parseRunwayJournalUpdate", () => {
  it("parses id + body without an envelope key (envelopeId omitted from result)", () => {
    const { body } = sealedNote("note")
    const value = expectOk(
      parseRunwayJournalUpdate({ id: "entry_1", encryptedBody: body }),
    )
    expect(value).toEqual({ id: "entry_1", encryptedBody: body })
    expect("envelopeId" in value).toBe(false)
  })

  it("includes envelopeId when the client sent it (including null to clear)", () => {
    const { body } = sealedNote("note")
    const withEnv = expectOk(
      parseRunwayJournalUpdate({
        id: "entry_1",
        encryptedBody: body,
        envelopeId: "env_2",
      }),
    )
    expect(withEnv.envelopeId).toBe("env_2")

    const cleared = expectOk(
      parseRunwayJournalUpdate({
        id: "entry_1",
        encryptedBody: body,
        envelopeId: null,
      }),
    )
    expect("envelopeId" in cleared).toBe(true)
    expect(cleared.envelopeId).toBeNull()
  })

  it("rejects missing id, plaintext, and a missing body", () => {
    const { body } = sealedNote("note")
    expect(parseRunwayJournalUpdate({ encryptedBody: body }).ok).toBe(false)
    expect(parseRunwayJournalUpdate({ id: "entry_1" }).ok).toBe(false)
    expect(
      parseRunwayJournalUpdate({ id: "", encryptedBody: body }).ok,
    ).toBe(false)
    expect(
      parseRunwayJournalUpdate({
        id: "entry_1",
        encryptedBody: "plain note",
      }).ok,
    ).toBe(false)
    expect(parseRunwayJournalUpdate(null).ok).toBe(false)
  })

  it("rejects a bad envelopeId when one is sent", () => {
    const { body } = sealedNote("note")
    expect(
      parseRunwayJournalUpdate({
        id: "entry_1",
        encryptedBody: body,
        envelopeId: "   ",
      }).ok,
    ).toBe(false)
  })
})
