// @vitest-environment node
import { webcrypto } from "node:crypto"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { encryptFieldAsymmetric, generateKeyPairFromSeed } from "@/lib/crypto"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db", () => ({
  prisma: {
    runwayJournalEntry: {
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
    envelope: {
      findFirst: vi.fn(),
    },
  },
}))

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { DELETE, GET, PATCH, POST } from "@/app/api/runway/journal/route"

const userId = "user-1"
const plaintext = "Friends visited and we ate out"

let cipher = ""

beforeAll(() => {
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto as unknown as Crypto
  }
  const seed = new Uint8Array(32)
  for (let i = 0; i < seed.length; i++) seed[i] = i + 3
  const { publicKey } = generateKeyPairFromSeed(seed)
  cipher = encryptFieldAsymmetric(plaintext, publicKey)
})

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "entry_1",
    monthKey: "2026-03",
    envelopeId: null,
    encryptedBody: cipher,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-02T00:00:00.000Z"),
    ...overrides,
  }
}

function get(query = "") {
  return GET(new NextRequest(`http://localhost/api/runway/journal${query}`))
}

function write(method: "POST" | "PATCH", body: unknown) {
  const handler = method === "POST" ? POST : PATCH
  return handler(
    new NextRequest("http://localhost/api/runway/journal", {
      method,
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  )
}

function del(query = "") {
  return DELETE(new NextRequest(`http://localhost/api/runway/journal${query}`))
}

describe("journal route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never)
  })

  it("returns 401 and does not read when signed out", async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    const res = await get("?monthKey=2026-03")
    expect(res.status).toBe(401)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(prisma.runwayJournalEntry.findMany).not.toHaveBeenCalled()
  })

  it("lists only the session user's notes for the requested month", async () => {
    vi.mocked(prisma.runwayJournalEntry.findMany).mockResolvedValue([
      entry(),
    ] as never)
    const res = await get("?monthKey=2026-03")
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(prisma.runwayJournalEntry.findMany).toHaveBeenCalledWith({
      where: { userId, monthKey: "2026-03" },
      orderBy: { createdAt: "desc" },
    })
    const body = await res.json()
    expect(body[0].encryptedBody).toBe(cipher)
    expect(JSON.stringify(body)).not.toContain("Friends")
    expect(body[0]).not.toHaveProperty("userId")
  })

  it("rejects a bad month before querying", async () => {
    const res = await get("?monthKey=2026-13")
    expect(res.status).toBe(400)
    expect(prisma.runwayJournalEntry.findMany).not.toHaveBeenCalled()
  })

  it("refuses a plaintext note and does not write it", async () => {
    const res = await write("POST", {
      userId: "someone-else",
      monthKey: "2026-03",
      encryptedBody: plaintext,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    const body = await res.json()
    expect(body.error).not.toContain("Friends")
    expect(prisma.runwayJournalEntry.create).not.toHaveBeenCalled()
  })

  it("stores the sealed box on the session user and ignores a body userId", async () => {
    vi.mocked(prisma.envelope.findFirst).mockResolvedValue({ id: "env_1" } as never)
    vi.mocked(prisma.runwayJournalEntry.create).mockResolvedValue(
      entry({ envelopeId: "env_1" }) as never,
    )
    const res = await write("POST", {
      userId: "someone-else",
      monthKey: "2026-03",
      encryptedBody: cipher,
      envelopeId: "env_1",
    })
    expect(res.status).toBe(201)
    expect(prisma.envelope.findFirst).toHaveBeenCalledWith({
      where: { id: "env_1", userId },
      select: { id: true },
    })
    expect(prisma.runwayJournalEntry.create).toHaveBeenCalledWith({
      data: {
        userId,
        monthKey: "2026-03",
        envelopeId: "env_1",
        encryptedBody: cipher,
      },
    })
    const body = await res.json()
    expect(body.encryptedBody).toBe(cipher)
    expect(body).not.toHaveProperty("userId")
  })

  it("does not attach another person's envelope", async () => {
    vi.mocked(prisma.envelope.findFirst).mockResolvedValue(null)
    const res = await write("POST", {
      monthKey: "2026-03",
      encryptedBody: cipher,
      envelopeId: "env_other",
    })
    expect(res.status).toBe(400)
    expect(prisma.runwayJournalEntry.create).not.toHaveBeenCalled()
  })

  it("updates only the session user's entry", async () => {
    vi.mocked(prisma.runwayJournalEntry.updateMany).mockResolvedValue({
      count: 1,
    } as never)
    vi.mocked(prisma.runwayJournalEntry.findFirst).mockResolvedValue(
      entry() as never,
    )
    const res = await write("PATCH", {
      id: "entry_1",
      userId: "someone-else",
      encryptedBody: cipher,
    })
    expect(res.status).toBe(200)
    expect(prisma.runwayJournalEntry.updateMany).toHaveBeenCalledWith({
      where: { id: "entry_1", userId },
      data: { encryptedBody: cipher },
    })
    expect(prisma.runwayJournalEntry.findFirst).toHaveBeenCalledWith({
      where: { id: "entry_1", userId },
    })
  })

  it("does not reveal whether another user's id exists", async () => {
    vi.mocked(prisma.runwayJournalEntry.updateMany).mockResolvedValue({
      count: 0,
    } as never)
    const res = await write("PATCH", { id: "entry_other", encryptedBody: cipher })
    expect(res.status).toBe(404)
    expect(prisma.runwayJournalEntry.findFirst).not.toHaveBeenCalled()
  })

  it("deletes only the session user's entry", async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    const signedOut = await del("?id=entry_1")
    expect(signedOut.status).toBe(401)
    expect(prisma.runwayJournalEntry.deleteMany).not.toHaveBeenCalled()

    vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never)
    vi.mocked(prisma.runwayJournalEntry.deleteMany).mockResolvedValue({
      count: 1,
    } as never)
    const res = await del("?id=entry_1")
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(prisma.runwayJournalEntry.deleteMany).toHaveBeenCalledWith({
      where: { id: "entry_1", userId },
    })
  })
})
