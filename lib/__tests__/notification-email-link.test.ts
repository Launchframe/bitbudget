// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const txQueryRaw = vi.hoisted(() => vi.fn())
const txNotificationFindUnique = vi.hoisted(() => vi.fn())
const txNotificationCount = vi.hoisted(() => vi.fn())
const txNotificationUpsert = vi.hoisted(() => vi.fn())
const txEmailCodeDeleteMany = vi.hoisted(() => vi.fn())

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
    $transaction: vi.fn(),
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
const transaction = vi.mocked(prisma.$transaction)

beforeEach(() => {
  vi.clearAllMocks()
  userFindFirst.mockResolvedValue(null)
  userFindUnique.mockResolvedValue({ email: null } as never)
  notificationFindUnique.mockResolvedValue(null)
  txQueryRaw.mockResolvedValue([])
  txNotificationFindUnique.mockResolvedValue(null)
  txNotificationCount.mockResolvedValue(0)
  txNotificationUpsert.mockResolvedValue({
    id: "row-1",
    email: "notify@example.com",
    verifiedAt: new Date("2026-01-01"),
  } as never)
  txEmailCodeDeleteMany.mockResolvedValue({ count: 1 } as never)
  transaction.mockImplementation(async (fn) =>
    fn({
      $queryRaw: txQueryRaw,
      userNotificationEmail: {
        findUnique: txNotificationFindUnique,
        count: txNotificationCount,
        upsert: txNotificationUpsert,
      },
      emailCode: { deleteMany: txEmailCodeDeleteMany },
    } as never),
  )
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

  it("locks the user row and re-counts before linking a new notification email", async () => {
    emailCodeFindFirst.mockResolvedValue({
      id: "code-1",
      code: "123456",
      failedAttempts: 0,
    } as never)
    vi.mocked(prisma.userNotificationEmail.findMany).mockResolvedValue([])

    await verifyNotificationEmailLink("user-1", "notify@example.com", "123456")

    expect(transaction).toHaveBeenCalled()
    expect(txQueryRaw).toHaveBeenCalled()
    expect(txNotificationCount).toHaveBeenCalledWith({ where: { userId: "user-1" } })
    expect(txNotificationUpsert).toHaveBeenCalled()
    expect(txEmailCodeDeleteMany).toHaveBeenCalledWith({
      where: { email: "notify@example.com" },
    })
  })
})
