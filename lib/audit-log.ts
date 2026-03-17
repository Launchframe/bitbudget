import { prisma } from "./db"

export async function logAdminAction(
  adminUserId: string,
  action: string,
  targetType?: string,
  targetId?: string,
  metadata?: Record<string, unknown>
) {
  await prisma.auditLog.create({
    data: {
      adminUserId,
      action,
      targetType,
      targetId,
      metadata: metadata ?? undefined,
    },
  })
}
