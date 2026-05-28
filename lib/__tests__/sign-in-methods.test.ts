// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Prisma } from "@prisma/client"

const mockVerifyEvent = vi.hoisted(() => vi.fn())

vi.mock("nostr-tools", () => ({
  verifyEvent: mockVerifyEvent,
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    emailCode: {
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

import { prisma } from "@/lib/db"
import {
  getSignInMethods,
  linkEmailSignInMethod,
  linkNostrSignInMethod,
  parseNostrAuthEvent,
  SignInMethodError,
} from "@/lib/sign-in-methods"
import {
  NOSTR_AUTH_EVENT_CONTENT,
  NOSTR_AUTH_EVENT_KIND,
  NOSTR_AUTH_EVENT_METHOD,
} from "@/lib/nostr-auth-event"

const userFindUnique = vi.mocked(prisma.user.findUnique)
const userUpdate = vi.mocked(prisma.user.update)
const emailCodeFindFirst = vi.mocked(prisma.emailCode.findFirst)
const emailCodeDeleteMany = vi.mocked(prisma.emailCode.deleteMany)

function uniqueConstraint(field: string) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: [field] },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getSignInMethods", () => {
  it("returns linked email, Nostr, and supported OAuth providers", async () => {
    userFindUnique.mockResolvedValue({
      email: "a@example.com",
      nostrPubkey: "f".repeat(64),
      accounts: [
        { provider: "google" },
        { provider: "google" },
        { provider: "github" },
        { provider: "other" },
      ],
    } as never)

    await expect(getSignInMethods("user-1")).resolves.toEqual({
      email: "a@example.com",
      emailLinked: true,
      nostrPubkey: "f".repeat(64),
      nostrLinked: true,
      oauthProviders: ["google", "github"],
    })
  })
})

describe("linkEmailSignInMethod", () => {
  it("links an unused email after a valid code", async () => {
    userFindUnique.mockResolvedValue(null)
    emailCodeFindFirst.mockResolvedValue({ id: "code-1" } as never)
    userUpdate.mockResolvedValue({ email: "new@example.com" } as never)

    await expect(
      linkEmailSignInMethod({
        userId: "user-1",
        email: " New@Example.com ",
        code: "123456",
      }),
    ).resolves.toEqual({ email: "new@example.com", emailLinked: true })

    expect(emailCodeDeleteMany).toHaveBeenCalledWith({ where: { email: "new@example.com" } })
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { email: "new@example.com", emailVerified: expect.any(Date) },
      select: { email: true },
    })
  })

  it("rejects an email owned by another user", async () => {
    userFindUnique.mockResolvedValue({ id: "other-user" } as never)

    await expect(
      linkEmailSignInMethod({
        userId: "user-1",
        email: "taken@example.com",
        code: "123456",
      }),
    ).rejects.toMatchObject({
      code: "EMAIL_ALREADY_LINKED",
      status: 409,
    } satisfies Partial<SignInMethodError>)

    expect(userUpdate).not.toHaveBeenCalled()
  })

  it("rejects an invalid or expired code", async () => {
    userFindUnique.mockResolvedValue(null)
    emailCodeFindFirst.mockResolvedValue(null)

    await expect(
      linkEmailSignInMethod({
        userId: "user-1",
        email: "new@example.com",
        code: "123456",
      }),
    ).rejects.toMatchObject({ code: "INVALID_CODE" })
  })

  it("maps a raced unique email constraint to a 409", async () => {
    userFindUnique.mockResolvedValue(null)
    emailCodeFindFirst.mockResolvedValue({ id: "code-1" } as never)
    userUpdate.mockRejectedValue(uniqueConstraint("email") as never)

    await expect(
      linkEmailSignInMethod({
        userId: "user-1",
        email: "new@example.com",
        code: "123456",
      }),
    ).rejects.toMatchObject({
      code: "EMAIL_ALREADY_LINKED",
      status: 409,
    } satisfies Partial<SignInMethodError>)

    expect(emailCodeDeleteMany).not.toHaveBeenCalled()
  })
})

describe("linkNostrSignInMethod", () => {
  const pubkey = "a".repeat(64)
  const authEvent = (overrides: Record<string, unknown> = {}) => JSON.stringify({
    kind: NOSTR_AUTH_EVENT_KIND,
    content: NOSTR_AUTH_EVENT_CONTENT,
    created_at: Math.floor(Date.now() / 1000),
    pubkey,
    tags: [
      ["u", "https://app.example.com"],
      ["method", NOSTR_AUTH_EVENT_METHOD],
    ],
    id: "event-id",
    sig: "event-sig",
    ...overrides,
  })
  const event = authEvent()

  it("links an unused Nostr key after signature verification", async () => {
    mockVerifyEvent.mockReturnValue(true)
    userFindUnique.mockResolvedValue(null)
    userUpdate.mockResolvedValue({ nostrPubkey: pubkey } as never)

    await expect(
      linkNostrSignInMethod({
        userId: "user-1",
        pubkey,
        event,
        expectedOrigin: "https://app.example.com",
        profileName: "Alice",
        profileImage: "https://example.com/a.png",
      }),
    ).resolves.toEqual({ nostrPubkey: pubkey, nostrLinked: true })

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        nostrPubkey: pubkey,
        name: "Alice",
        image: "https://example.com/a.png",
      },
      select: { nostrPubkey: true },
    })
  })

  it("normalizes Nostr pubkeys before checking ownership and storing", async () => {
    mockVerifyEvent.mockReturnValue(true)
    userFindUnique.mockResolvedValue(null)
    userUpdate.mockResolvedValue({ nostrPubkey: pubkey } as never)

    await expect(
      linkNostrSignInMethod({
        userId: "user-1",
        pubkey: pubkey.toUpperCase(),
        event,
        expectedOrigin: "https://app.example.com",
      }),
    ).resolves.toEqual({ nostrPubkey: pubkey, nostrLinked: true })

    expect(userFindUnique).toHaveBeenCalledWith({
      where: { nostrPubkey: pubkey },
      select: { id: true },
    })
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { nostrPubkey: pubkey },
      select: { nostrPubkey: true },
    })
  })

  it("sanitizes client-provided Nostr profile metadata before storing", async () => {
    mockVerifyEvent.mockReturnValue(true)
    userFindUnique.mockResolvedValue(null)
    userUpdate.mockResolvedValue({ nostrPubkey: pubkey } as never)

    await linkNostrSignInMethod({
      userId: "user-1",
      pubkey,
      event,
      expectedOrigin: "https://app.example.com",
      profileName: ` ${"A".repeat(90)} `,
      profileImage: "javascript:alert(1)",
    })

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        nostrPubkey: pubkey,
        name: "A".repeat(80),
      },
      select: { nostrPubkey: true },
    })
  })

  it("rejects a Nostr key owned by another user", async () => {
    mockVerifyEvent.mockReturnValue(true)
    userFindUnique.mockResolvedValue({ id: "other-user" } as never)

    await expect(
      linkNostrSignInMethod({
        userId: "user-1",
        pubkey,
        event,
        expectedOrigin: "https://app.example.com",
      }),
    ).rejects.toMatchObject({
      code: "NOSTR_ALREADY_LINKED",
      status: 409,
    } satisfies Partial<SignInMethodError>)
  })

  it("rejects an event that does not verify for the provided pubkey", async () => {
    mockVerifyEvent.mockReturnValue(false)

    await expect(
      linkNostrSignInMethod({
        userId: "user-1",
        pubkey,
        event,
        expectedOrigin: "https://app.example.com",
      }),
    ).rejects.toMatchObject({ code: "INVALID_NOSTR_EVENT" })

    expect(userUpdate).not.toHaveBeenCalled()
  })

  it("maps verifier exceptions to an invalid Nostr event", async () => {
    mockVerifyEvent.mockImplementation(() => {
      throw new Error("malformed event")
    })

    await expect(
      linkNostrSignInMethod({
        userId: "user-1",
        pubkey,
        event,
        expectedOrigin: "https://app.example.com",
      }),
    ).rejects.toMatchObject({ code: "INVALID_NOSTR_EVENT" })

    expect(userUpdate).not.toHaveBeenCalled()
  })

  it("rejects non-auth Nostr events before linking", async () => {
    mockVerifyEvent.mockReturnValue(true)

    await expect(
      linkNostrSignInMethod({
        userId: "user-1",
        pubkey,
        event: authEvent({ kind: 1, content: "public note" }),
        expectedOrigin: "https://app.example.com",
      }),
    ).rejects.toMatchObject({ code: "INVALID_NOSTR_EVENT" })

    expect(mockVerifyEvent).not.toHaveBeenCalled()
    expect(userFindUnique).not.toHaveBeenCalled()
    expect(userUpdate).not.toHaveBeenCalled()
  })

  it("rejects stale Nostr auth events before linking", async () => {
    mockVerifyEvent.mockReturnValue(true)

    await expect(
      linkNostrSignInMethod({
        userId: "user-1",
        pubkey,
        event: authEvent({ created_at: Math.floor(Date.now() / 1000) - 3600 }),
        expectedOrigin: "https://app.example.com",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_NOSTR_EVENT",
      message: "Nostr sign-in request expired",
    })

    expect(mockVerifyEvent).not.toHaveBeenCalled()
    expect(userFindUnique).not.toHaveBeenCalled()
    expect(userUpdate).not.toHaveBeenCalled()
  })

  it("rejects auth events for a different origin", async () => {
    mockVerifyEvent.mockReturnValue(true)

    await expect(
      linkNostrSignInMethod({
        userId: "user-1",
        pubkey,
        event,
        expectedOrigin: "https://evil.example.com",
      }),
    ).rejects.toMatchObject({ code: "INVALID_NOSTR_EVENT" })
  })

  it("maps a raced unique Nostr constraint to a 409", async () => {
    mockVerifyEvent.mockReturnValue(true)
    userFindUnique.mockResolvedValue(null)
    userUpdate.mockRejectedValue(uniqueConstraint("nostrPubkey") as never)

    await expect(
      linkNostrSignInMethod({
        userId: "user-1",
        pubkey,
        event,
        expectedOrigin: "https://app.example.com",
      }),
    ).rejects.toMatchObject({
      code: "NOSTR_ALREADY_LINKED",
      status: 409,
    } satisfies Partial<SignInMethodError>)
  })
})

/**
 * Tests for parseNostrAuthEvent (exported for use in lib/auth.ts Nostr provider).
 * Guards against the Nostr auth bypass: an attacker must not be able to replay
 * an arbitrary signed Nostr event (e.g. a public kind-1 post) to authenticate.
 */
describe("parseNostrAuthEvent", () => {
  const pubkey = "b".repeat(64)
  const now = () => Math.floor(Date.now() / 1000)

  const validEventStr = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      kind: NOSTR_AUTH_EVENT_KIND,
      content: NOSTR_AUTH_EVENT_CONTENT,
      created_at: now(),
      pubkey,
      tags: [["method", NOSTR_AUTH_EVENT_METHOD]],
      id: "abc",
      sig: "sig",
      ...overrides,
    })

  it("accepts a well-formed auth event and returns the parsed object", () => {
    const result = parseNostrAuthEvent(validEventStr(), pubkey)
    expect(result.kind).toBe(NOSTR_AUTH_EVENT_KIND)
    expect(result.content).toBe(NOSTR_AUTH_EVENT_CONTENT)
  })

  it("rejects a non-auth event kind (Nostr auth bypass guard)", () => {
    // A kind-1 public note signed by the user's key must NOT authenticate them
    expect(() =>
      parseNostrAuthEvent(validEventStr({ kind: 1, content: "hello world" }), pubkey),
    ).toThrow(SignInMethodError)
  })

  it("rejects wrong content string", () => {
    expect(() =>
      parseNostrAuthEvent(validEventStr({ content: "Not BitBudget" }), pubkey),
    ).toThrow(SignInMethodError)
  })

  it("rejects a stale event (replay protection)", () => {
    expect(() =>
      parseNostrAuthEvent(validEventStr({ created_at: now() - 3600 }), pubkey),
    ).toThrow(SignInMethodError)
  })

  it("rejects a far-future event", () => {
    expect(() =>
      parseNostrAuthEvent(validEventStr({ created_at: now() + 300 }), pubkey),
    ).toThrow(SignInMethodError)
  })

  it("rejects an event missing the method tag", () => {
    expect(() =>
      parseNostrAuthEvent(validEventStr({ tags: [] }), pubkey),
    ).toThrow(SignInMethodError)
  })

  it("rejects an event whose pubkey does not match the provided pubkey", () => {
    expect(() =>
      parseNostrAuthEvent(validEventStr({ pubkey: "c".repeat(64) }), pubkey),
    ).toThrow(SignInMethodError)
  })

  it("rejects malformed JSON", () => {
    expect(() => parseNostrAuthEvent("not-json", pubkey)).toThrow(SignInMethodError)
  })

  it("rejects when expectedOrigin is required but the tag is missing", () => {
    expect(() =>
      parseNostrAuthEvent(validEventStr(), pubkey, "https://app.example.com"),
    ).toThrow(SignInMethodError)
  })

  it("accepts when expectedOrigin tag matches", () => {
    const eventWithOrigin = validEventStr({
      tags: [
        ["u", "https://app.example.com"],
        ["method", NOSTR_AUTH_EVENT_METHOD],
      ],
    })
    expect(() =>
      parseNostrAuthEvent(eventWithOrigin, pubkey, "https://app.example.com"),
    ).not.toThrow()
  })
})
