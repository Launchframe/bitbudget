// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

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
  SignInMethodError,
} from "@/lib/sign-in-methods"

const userFindUnique = vi.mocked(prisma.user.findUnique)
const userUpdate = vi.mocked(prisma.user.update)
const emailCodeFindFirst = vi.mocked(prisma.emailCode.findFirst)
const emailCodeDeleteMany = vi.mocked(prisma.emailCode.deleteMany)

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
})

describe("linkNostrSignInMethod", () => {
  const pubkey = "a".repeat(64)
  const event = JSON.stringify({ pubkey })

  it("links an unused Nostr key after signature verification", async () => {
    mockVerifyEvent.mockReturnValue(true)
    userFindUnique.mockResolvedValue(null)
    userUpdate.mockResolvedValue({ nostrPubkey: pubkey } as never)

    await expect(
      linkNostrSignInMethod({
        userId: "user-1",
        pubkey,
        event,
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

  it("rejects a Nostr key owned by another user", async () => {
    mockVerifyEvent.mockReturnValue(true)
    userFindUnique.mockResolvedValue({ id: "other-user" } as never)

    await expect(
      linkNostrSignInMethod({
        userId: "user-1",
        pubkey,
        event,
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
      }),
    ).rejects.toMatchObject({ code: "INVALID_NOSTR_EVENT" })

    expect(userUpdate).not.toHaveBeenCalled()
  })
})
