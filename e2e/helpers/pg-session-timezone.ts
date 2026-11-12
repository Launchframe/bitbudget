import { prisma } from "../../lib/db"

/** Escape single quotes for safe use in SET TIME ZONE (identifier is still caller-controlled). */
function quotePgTimeZone(tz: string): string {
  return `'${tz.replace(/'/g, "''")}'`
}

/**
 * Run fn with Postgres session TimeZone set on this worker's Prisma connection.
 * Restores UTC afterward so later specs are not affected.
 */
export async function withPgSessionTimeZone<T>(timeZone: string, fn: () => Promise<T>): Promise<T> {
  await prisma.$executeRawUnsafe(`SET TIME ZONE ${quotePgTimeZone(timeZone)}`)
  try {
    return await fn()
  } finally {
    await prisma.$executeRaw`SET TIME ZONE 'UTC'`
  }
}
