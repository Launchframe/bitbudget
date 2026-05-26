// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    userNotificationEmail: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    emailCode: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/email", () => ({
  sendNotificationEmailVerificationCode: vi.fn(),
}))

import { prisma } from "@/lib/db"
import {
  MAX_VERIFY_CODE_ATTEMPTS,
  verifyNotificationEmailLink,
} from "@/lib/notification-email-link"

const userFindUnique = vi.mocked(prisma.user.findUnique)
const userFindFirst = vi.mocked(prisma.user.findFirst)
const emailCodeFindFirst = vi.mocked(prisma.emailCode.findFirst)
const emailCodeUpdate = vi.mocked(prisma.emailCode.update)
const emailCodeDeleteMany = vi.mocked(prisma.emailCode.deleteMany)
const notificationFindUnique = vi.mocked(prisma.userNotificationEmail.findUnique)

beforeEach(() => {
  vi.clearAllMocks()
  userFindFirst.mockResolvedValue(null)
  userFindUnique.mockResolvedValue({
    email: null,
    _count: { notificationEmails: 0 },
  } as never)
  notificationFindUnique.mockResolvedValue(null)
})

describe("verifyNotificationEmailLink", () => {
  it("increments failedAttempts on wrong code", async () => {
    emailCodeFindFirst.mockResolvedValue({
      id: "code-1",
      code: "111111",
      failedAttempts: 0,
    } as never)
    emailCodeUpdate.mockResolvedValue({} as never)

    await expect(
      verifyNotificationEmailLink("user-1", "notify@example.com", "222222"),
    ).rejects.toMatchObject({ code: "INVALID_CODE" })

    expect(emailCodeUpdate).toHaveBeenCalledWith({
      where: { id: "code-1" },
      data: { failedAttempts: 1 },
    })
  })

  it("rate-limits after too many wrong codes", async () => {
    emailCodeFindFirst.mockResolvedValue({
      id: "code-1",
      code: "111111",
      failedAttempts: MAX_VERIFY_CODE_ATTEMPTS - 1,
    } as never)
    emailCodeDeleteMany.mockResolvedValue({ count: 1 } as never)

    await expect(
      verifyNotificationEmailLink("user-1", "notify@example.com", "222222"),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
    })

    expect(emailCodeDeleteMany).toHaveBeenCalledWith({
      where: { email: "notify@example.com" },
    })
    expect(emailCodeUpdate).not.toHaveBeenCalled()
  })
})
