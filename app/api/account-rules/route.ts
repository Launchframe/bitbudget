import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import type {
  RuleTrigger,
  RuleType,
  AccountRuleCreate,
  AccountRuleUpdate,
} from "@/lib/account-rules"

const VALID_TYPES: RuleType[] = [
  "payee_name",
  "auto_categorize",
  "skip",
  "auto_tag",
  "summary_email",
  "round_up",
  "surplus_sweep",
  "savings_floor",
  "subscription_auto_confirm",
  "irregular_income",
  "redact",
]

const VALID_TRIGGERS: RuleTrigger[] = [
  "on_import",
  "on_scan",
  "on_save",
  "on_schedule",
  "on_income",
]

function serializeRule(row: {
  id: string
  userId: string
  type: string
  trigger: string
  priority: number
  enabled: boolean
  conditions: unknown
  actions: unknown
  templateId: string | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    trigger: row.trigger,
    priority: row.priority,
    enabled: row.enabled,
    conditions: row.conditions,
    actions: row.actions,
    templateId: row.templateId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rows = await prisma.accountRule.findMany({
    where: { userId: session.user.id },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  })

  return NextResponse.json(rows.map(serializeRule))
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const b = body as Partial<AccountRuleCreate>

  if (!b.type || !VALID_TYPES.includes(b.type as RuleType)) {
    return NextResponse.json({ error: "Invalid or missing rule type" }, { status: 400 })
  }
  if (!b.trigger || !VALID_TRIGGERS.includes(b.trigger as RuleTrigger)) {
    return NextResponse.json({ error: "Invalid or missing trigger" }, { status: 400 })
  }
  if (!Array.isArray(b.conditions) || !Array.isArray(b.actions)) {
    return NextResponse.json({ error: "conditions and actions must be arrays" }, { status: 400 })
  }

  const row = await prisma.accountRule.create({
    data: {
      userId: session.user.id,
      type: b.type,
      trigger: b.trigger,
      priority: typeof b.priority === "number" ? b.priority : 0,
      enabled: b.enabled !== false,
      conditions: b.conditions as unknown as Prisma.InputJsonValue,
      actions: b.actions as unknown as Prisma.InputJsonValue,
      templateId: typeof b.templateId === "string" ? b.templateId : null,
    },
  })

  return NextResponse.json(serializeRule(row), { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const id = req.nextUrl.searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const b = body as Partial<AccountRuleUpdate>

  const updateData: Record<string, unknown> = {}
  if (typeof b.enabled === "boolean") updateData.enabled = b.enabled
  if (typeof b.priority === "number") updateData.priority = b.priority
  if (Array.isArray(b.conditions)) {
    updateData.conditions = b.conditions as unknown as Prisma.InputJsonValue
  }
  if (Array.isArray(b.actions)) {
    updateData.actions = b.actions as unknown as Prisma.InputJsonValue
  }
  if (b.trigger && VALID_TRIGGERS.includes(b.trigger as RuleTrigger)) {
    updateData.trigger = b.trigger
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
  }

  const result = await prisma.accountRule.updateMany({
    where: { id, userId: session.user.id },
    data: updateData,
  })

  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const row = await prisma.accountRule.findFirst({ where: { id, userId: session.user.id } })
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json(serializeRule(row))
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const id = req.nextUrl.searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 })
  }

  const result = await prisma.accountRule.deleteMany({
    where: { id, userId: session.user.id },
  })

  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
