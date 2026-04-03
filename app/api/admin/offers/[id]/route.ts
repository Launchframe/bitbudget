import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin"
import { prisma } from "@/lib/db"

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin()
  if (error) return error

  const { id } = await ctx.params
  const row = await prisma.referralCode.findFirst({
    where: { id, type: "offer" },
  })
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  let body: Partial<{
    label: string | null
    maxUses: number
    startsAt: string
    expiresAt: string
    active: boolean
  }>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const data: Record<string, unknown> = {}
  if (body.label !== undefined) data.label = body.label === null ? null : String(body.label).slice(0, 200)
  if (body.maxUses !== undefined && typeof body.maxUses === "number" && body.maxUses >= 1) {
    data.maxUses = Math.min(Math.floor(body.maxUses), 1_000_000)
  }
  if (body.startsAt !== undefined) {
    const d = new Date(body.startsAt)
    if (!Number.isNaN(d.getTime())) data.startsAt = d
  }
  if (body.expiresAt !== undefined) {
    const d = new Date(body.expiresAt)
    if (!Number.isNaN(d.getTime())) data.expiresAt = d
  }
  if (body.active !== undefined) data.active = Boolean(body.active)

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields" }, { status: 400 })
  }

  const nextStartsAt = (data.startsAt as Date | undefined) ?? row.startsAt
  const nextExpiresAt = (data.expiresAt as Date | undefined) ?? row.expiresAt
  if (nextExpiresAt <= nextStartsAt) {
    return NextResponse.json({ error: "expiresAt must be after startsAt" }, { status: 400 })
  }

  const updated = await prisma.referralCode.update({
    where: { id },
    data,
  })

  return NextResponse.json({
    id: updated.id,
    code: updated.code,
    label: updated.label,
    maxUses: updated.maxUses,
    startsAt: updated.startsAt.toISOString(),
    expiresAt: updated.expiresAt.toISOString(),
    active: updated.active,
  })
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin()
  if (error) return error

  const { id } = await ctx.params
  const row = await prisma.referralCode.findFirst({
    where: { id, type: "offer" },
  })
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  await prisma.referralCode.update({
    where: { id },
    data: { active: false },
  })

  return NextResponse.json({ ok: true })
}
