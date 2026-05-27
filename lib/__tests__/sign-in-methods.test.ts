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

// ---------------------------------------------------------------------------
// parseNostrAuthEvent — the semantic gate that lib/auth.ts calls before verifyEvent.
// These tests document the auth-bypass vulnerability (relay-note replay) and prove
// the guard blocks it. Without this validation any scraped kind=1 Nostr note would
// authenticate as its author.
// ---------------------------------------------------------------------------
describe("parseNostrAuthEvent", () => {
  const pubkey = "b".repeat(64)
  const NOW = Math.floor(Date.now() / 1000)

  const validEvent = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      kind: NOSTR_AUTH_EVENT_KIND,
      content: NOSTR_AUTH_EVENT_CONTENT,
      created_at: NOW,
      pubkey,
      tags: [["method", NOSTR_AUTH_EVENT_METHOD]],
      id: "event-id",
      sig: "sig",
      ...overrides,
    })

  it("accepts a well-formed auth event and returns the parsed object", () => {
    const result = parseNostrAuthEvent(validEvent(), pubkey)
    expect(result.kind).toBe(NOSTR_AUTH_EVENT_KIND)
    expect(result.content).toBe(NOSTR_AUTH_EVENT_CONTENT)
  })

  it("rejects a kind=1 note (relay-note replay attack)", () => {
    // This is the exact scenario that was exploited: attacker submits a public Nostr
    // note (kind=1) signed by the victim to authenticate as them.
    expect(() =>
      parseNostrAuthEvent(validEvent({ kind: 1, content: "hello world" }), pubkey),
    ).toThrow(SignInMethodError)
  })

  it("rejects an event with wrong content", () => {
    expect(() =>
      parseNostrAuthEvent(validEvent({ content: "not a login" }), pubkey),
    ).toThrow(SignInMethodError)
  })

  it("rejects an event signed by a different pubkey than claimed", () => {
    const differentPubkey = "c".repeat(64)
    expect(() =>
      parseNostrAuthEvent(validEvent({ pubkey: differentPubkey }), pubkey),
    ).toThrow(SignInMethodError)
  })

  it("rejects a stale event (> 5 minutes old)", () => {
    expect(() =>
      parseNostrAuthEvent(validEvent({ created_at: NOW - 400 }), pubkey),
    ).toThrow(SignInMethodError)
  })

  it("rejects a future-dated event (> 60s skew)", () => {
    expect(() =>
      parseNostrAuthEvent(validEvent({ created_at: NOW + 120 }), pubkey),
    ).toThrow(SignInMethodError)
  })

  it("rejects an event missing the method tag", () => {
    expect(() =>
      parseNostrAuthEvent(validEvent({ tags: [] }), pubkey),
    ).toThrow(SignInMethodError)
  })

  it("rejects an event with a wrong method tag value", () => {
    expect(() =>
      parseNostrAuthEvent(
        validEvent({ tags: [["method", "not-login"]] }),
        pubkey,
      ),
    ).toThrow(SignInMethodError)
  })

  it("rejects malformed JSON", () => {
    expect(() => parseNostrAuthEvent("{bad json", pubkey)).toThrow(SignInMethodError)
  })

  it("rejects when expectedOrigin is provided but not in the event tags", () => {
    expect(() =>
      parseNostrAuthEvent(validEvent(), pubkey, "https://app.example.com"),
    ).toThrow(SignInMethodError)
  })

  it("accepts when expectedOrigin matches a u tag in the event", () => {
    const eventWithU = validEvent({
      tags: [["method", NOSTR_AUTH_EVENT_METHOD], ["u", "https://app.example.com"]],
    })
    expect(() =>
      parseNostrAuthEvent(eventWithU, pubkey, "https://app.example.com"),
    ).not.toThrow()
  })
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
