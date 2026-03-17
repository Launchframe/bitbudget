// prisma/seed-admin.ts
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  const adminEmails = process.env.ADMIN_EMAILS?.split(",").map((e) => e.trim()) ?? []

  if (adminEmails.length === 0) {
    console.log("No ADMIN_EMAILS set. Skipping admin seed.")
    return
  }

  for (const email of adminEmails) {
    const user = await prisma.user.updateMany({
      where: { email },
      data: { role: "admin" },
    })
    console.log(`Set admin role for ${email}: ${user.count} user(s) updated`)
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
