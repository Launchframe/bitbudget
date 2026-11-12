// @vitest-environment node
import { describe, it, expect, vi } from "vitest"
import { Prisma } from "@prisma/client"

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }))

import { prismaErrorResponse } from "../api-error"

describe("prismaErrorResponse", () => {
  it("maps P2002 to 409", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique", {
      code: "P2002",
      clientVersion: "5.22.0",
    })
    const res = prismaErrorResponse(err)
    expect(res?.status).toBe(409)
  })

  it("maps P2025 to 404", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Not found", {
      code: "P2025",
      clientVersion: "5.22.0",
    })
    const res = prismaErrorResponse(err)
    expect(res?.status).toBe(404)
  })

  it("maps validation errors to 500 schema_drift", async () => {
    const err = new Prisma.PrismaClientValidationError("Unknown field", { clientVersion: "5.22.0" })
    const res = prismaErrorResponse(err)
    expect(res?.status).toBe(500)
    const body = await res!.json()
    expect(body.code).toBe("schema_drift")
  })

  it("returns null for generic errors", () => {
    expect(prismaErrorResponse(new Error("boom"))).toBeNull()
  })
})
