import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import {
  RESERVED_SAVINGS_ENVELOPE_NAME,
  SYSTEM_ENVELOPE_ROLE_SAVINGS,
  isReservedSavingsEnvelopeName,
} from "@/lib/constants"
import { mergeEnvelopeRecords } from "@/lib/server-merge-envelope"

const TMP_PREFIX = "__bb_sync_tmp_"

type SyncBody = {
  envelopes?: Array<{
    id?: string
    name?: string
    color?: string
    icon?: string | null
    monthlyAllotment?: number
  }>
}

/**
 * Replace the user's envelope set to match onboarding (or full replace): delete server rows
 * not listed, update listed ids, create rows without ids. Safe cross-renames via a temp name phase.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  let body: SyncBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const raw = body.envelopes
  if (!Array.isArray(raw) || raw.length === 0) {
    return NextResponse.json({ error: "At least one envelope is required" }, { status: 400 })
  }

  const seenNameKeys = new Set<string>()
  const normalized: Array<{
    id?: string
    name: string
    color: string
    icon?: string | null
    monthlyAllotment: number
  }> = []

  for (const row of raw) {
    const name = typeof row.name === "string" ? row.name.trim() : ""
    if (!name) {
      return NextResponse.json({ error: "Each envelope needs a non-empty name" }, { status: 400 })
    }
    if (name.startsWith(TMP_PREFIX)) {
      return NextResponse.json({ error: "This envelope name is reserved" }, { status: 400 })
    }
    const nameKey = name.toLowerCase()
    if (seenNameKeys.has(nameKey)) {
      return NextResponse.json({ error: "Duplicate envelope names in request" }, { status: 400 })
    }
    seenNameKeys.add(nameKey)
    normalized.push({
      id: typeof row.id === "string" && row.id.length > 0 ? row.id : undefined,
      name,
      color: typeof row.color === "string" && row.color.length > 0 ? row.color : "#F7931A",
      icon: row.icon === undefined ? undefined : row.icon,
      monthlyAllotment:
        typeof row.monthlyAllotment === "number" && Number.isFinite(row.monthlyAllotment)
          ? row.monthlyAllotment
          : 0,
    })
  }

  try {
    const result = await prisma.$transaction(async tx => {
      let server = await tx.envelope.findMany({ where: { userId } })
      let serverById = new Map(server.map(e => [e.id, e]))

      const userSettings = await tx.user.findUnique({
        where: { id: userId },
        select: { ledgerFundingEnabled: true },
      })
      const ledgerOn = userSettings?.ledgerFundingEnabled ?? false

      if (ledgerOn) {
        let systemSav = server.find(e => e.systemRole === SYSTEM_ENVELOPE_ROLE_SAVINGS)
        const savingsDraft = normalized.find(
          e =>
            isReservedSavingsEnvelopeName(e.name) &&
            e.id &&
            serverById.has(e.id) &&
            (!systemSav || e.id !== systemSav.id),
        )

        if (systemSav && savingsDraft?.id && savingsDraft.id !== systemSav.id) {
          await mergeEnvelopeRecords(tx, userId, savingsDraft.id, systemSav.id)
          savingsDraft.id = systemSav.id
          server = await tx.envelope.findMany({ where: { userId } })
          serverById = new Map(server.map(e => [e.id, e]))
          systemSav = server.find(e => e.systemRole === SYSTEM_ENVELOPE_ROLE_SAVINGS)
        }

        if (!systemSav) {
          const lone = normalized.find(
            e => isReservedSavingsEnvelopeName(e.name) && e.id && serverById.has(e.id),
          )
          if (lone?.id) {
            await tx.envelope.update({
              where: { id: lone.id },
              data: {
                systemRole: SYSTEM_ENVELOPE_ROLE_SAVINGS,
                name: RESERVED_SAVINGS_ENVELOPE_NAME,
              },
            })
            server = await tx.envelope.findMany({ where: { userId } })
            serverById = new Map(server.map(e => [e.id, e]))
          }
        }
      }

      const draftIds = new Set(normalized.filter(e => e.id).map(e => e.id!))
      for (const id of draftIds) {
        if (!serverById.has(id)) {
          throw new Error("UNKNOWN_ID")
        }
      }

      const systemSavId = ledgerOn
        ? server.find(e => e.systemRole === SYSTEM_ENVELOPE_ROLE_SAVINGS)?.id
        : undefined

      const idsToDelete = server
        .filter(e => !draftIds.has(e.id) && (!systemSavId || e.id !== systemSavId))
        .map(e => e.id)

      if (idsToDelete.length > 0) {
        const txnCount = await tx.transaction.count({
          where: { userId, envelopeId: { in: idsToDelete } },
        })
        const recurringCount = await tx.recurringTransaction.count({
          where: { userId, envelopeId: { in: idsToDelete } },
        })
        if (txnCount > 0 || recurringCount > 0) {
          throw new Error("ENVELOPES_HAVE_DATA")
        }
        await tx.pendingTransaction.updateMany({
          where: { suggestedEnvelopeId: { in: idsToDelete } },
          data: { suggestedEnvelopeId: null },
        })
        await tx.payeeEnvelopeMapping.deleteMany({
          where: { envelopeId: { in: idsToDelete } },
        })
        await tx.transactionShortcut.deleteMany({
          where: { envelopeId: { in: idsToDelete } },
        })
        await tx.envelope.deleteMany({
          where: { userId, id: { in: idsToDelete } },
        })
      }

      const withIds = normalized.filter((e): e is typeof e & { id: string } => Boolean(e.id))

      for (const d of withIds) {
        await tx.envelope.update({
          where: { id: d.id },
          data: { name: `${TMP_PREFIX}${d.id}` },
        })
      }

      for (const d of withIds) {
        const isSystemSavings = ledgerOn && systemSavId !== undefined && d.id === systemSavId
        await tx.envelope.update({
          where: { id: d.id },
          data: isSystemSavings
            ? {
                name: RESERVED_SAVINGS_ENVELOPE_NAME,
                monthlyAllotment: 0,
                color: d.color,
                ...(d.icon !== undefined ? { icon: d.icon } : {}),
              }
            : {
                name: d.name,
                color: d.color,
                ...(d.icon !== undefined ? { icon: d.icon } : {}),
                monthlyAllotment: d.monthlyAllotment,
              },
        })
      }

      const createdRows: typeof server = []
      for (const d of normalized) {
        if (d.id) continue
        createdRows.push(
          await tx.envelope.create({
            data: {
              userId,
              name: d.name,
              color: d.color,
              icon: d.icon,
              monthlyAllotment: d.monthlyAllotment,
            },
          }),
        )
      }

      let createIdx = 0
      const ordered: typeof server = []
      for (const d of normalized) {
        if (d.id) {
          ordered.push(await tx.envelope.findUniqueOrThrow({ where: { id: d.id } }))
        } else {
          ordered.push(createdRows[createIdx++]!)
        }
      }
      return ordered
    })

    return NextResponse.json({
      envelopes: result.map(e => ({
        id: e.id,
        name: e.name,
        monthlyAllotment: e.monthlyAllotment,
        color: e.color,
        icon: e.icon,
        archived: e.archived,
        systemRole: e.systemRole ?? null,
      })),
    })
  } catch (e) {
    if (e instanceof Error && e.message === "UNKNOWN_ID") {
      return NextResponse.json({ error: "Unknown or stale envelope id" }, { status: 400 })
    }
    if (e instanceof Error && e.message === "ENVELOPES_HAVE_DATA") {
      return NextResponse.json(
        {
          error:
            "Cannot remove envelopes that already have transactions or recurring rules. Remove or move them first, or contact support.",
        },
        { status: 409 },
      )
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") {
        return NextResponse.json(
          { error: "An envelope with this name already exists" },
          { status: 409 },
        )
      }
    }
    console.error("envelope sync", e)
    return NextResponse.json({ error: "Sync failed" }, { status: 500 })
  }
}
