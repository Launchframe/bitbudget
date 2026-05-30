import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { Prisma } from "@prisma/client"

type RouteHandler = (req: NextRequest, ctx?: unknown) => Promise<Response> | Response

function prismaErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return NextResponse.json({ error: "Conflict", code: err.code }, { status: 409 })
    }
    if (err.code === "P2025") {
      return NextResponse.json({ error: "Not found", code: err.code }, { status: 404 })
    }
  }
  if (err instanceof Prisma.PrismaClientValidationError) {
    Sentry.captureException(err, { tags: { cause: "schema_drift" } })
    return NextResponse.json({ error: "Server configuration error", code: "schema_drift" }, { status: 500 })
  }
  return null
}

/** Wrap API route handlers with uniform Prisma error mapping and Sentry capture. */
export function withApiErrorHandler(handler: RouteHandler): RouteHandler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx)
    } catch (err) {
      const mapped = prismaErrorResponse(err)
      if (mapped) return mapped
      Sentry.captureException(err)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  }
}

export { prismaErrorResponse }
