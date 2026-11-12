#!/usr/bin/env npx tsx
/**
 * Print recent CronRun rows from Postgres.
 * Usage: pnpm ops:crons [--name recurring]
 */

import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  const nameArg = process.argv.find(a => a.startsWith("--name="))
  const name = nameArg?.split("=")[1]

  const runs = await prisma.cronRun.findMany({
    where: name ? { name } : undefined,
    orderBy: { startedAt: "desc" },
    take: name ? 20 : 30,
  })

  if (runs.length === 0) {
    console.log("No cron runs found.")
    return
  }

  for (const run of runs) {
    console.log(
      `${run.startedAt.toISOString()}  ${run.name}  ${run.status}  ${run.durationMs ?? "—"}ms  ${run.errorClass ?? ""}`,
    )
    if (run.errorMessage) console.log(`  ${run.errorMessage}`)
  }
}

main()
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
