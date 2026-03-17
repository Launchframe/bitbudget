// prisma/seed.ts — admin role assignment + common approved receipt senders
import { PrismaClient } from "@prisma/client"
import { decode } from "nostr-tools/nip19"

const prisma = new PrismaClient()

const COMMON_RECEIPT_SENDERS: { senderPattern: string; displayName: string }[] = [
  { senderPattern: "*@amazon.com", displayName: "Amazon" },
  { senderPattern: "*@uber.com", displayName: "Uber" },
  { senderPattern: "*@lyft.com", displayName: "Lyft" },
  { senderPattern: "*@doordash.com", displayName: "DoorDash" },
  { senderPattern: "*@grubhub.com", displayName: "Grubhub" },
  { senderPattern: "*@starbucks.com", displayName: "Starbucks" },
  { senderPattern: "*@apple.com", displayName: "Apple" },
  { senderPattern: "*@instacart.com", displayName: "Instacart" },
]

function npubToHex(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.startsWith("npub")) {
    try {
      const decoded = decode(trimmed)
      if (decoded.type === "npub") return decoded.data
    } catch {
      return null
    }
  }
  return trimmed
}

async function main() {
  const adminEmails = process.env.ADMIN_EMAILS?.split(",").map((e) => e.trim()).filter(Boolean) ?? []
  const adminNpubsRaw = process.env.ADMIN_NPUBS?.split(",").map((e) => e.trim()).filter(Boolean) ?? []
  const adminNpubHexes = adminNpubsRaw.map(npubToHex).filter((h): h is string => h !== null)
  let adminUserId: string | null = null

  if (adminEmails.length > 0) {
    for (const email of adminEmails) {
      const result = await prisma.user.updateMany({
        where: { email },
        data: { role: "admin" },
      })
      console.log(`Set admin role for ${email}: ${result.count} user(s) updated`)
    }
    const firstAdmin = await prisma.user.findFirst({
      where: { email: adminEmails[0] },
      select: { id: true },
    })
    adminUserId = firstAdmin?.id ?? null
  }

  if (adminNpubHexes.length > 0) {
    for (const hex of adminNpubHexes) {
      const result = await prisma.user.updateMany({
        where: { nostrPubkey: hex },
        data: { role: "admin" },
      })
      console.log(`Set admin role for npub (${hex.slice(0, 16)}…): ${result.count} user(s) updated`)
    }
    if (!adminUserId) {
      const firstAdmin = await prisma.user.findFirst({
        where: { nostrPubkey: adminNpubHexes[0] },
        select: { id: true },
      })
      adminUserId = firstAdmin?.id ?? null
    }
  }

  for (const { senderPattern, displayName } of COMMON_RECEIPT_SENDERS) {
    const existing = await prisma.approvedReceiptSender.findUnique({
      where: { senderPattern },
    })
    if (existing) {
      console.log(`Receipt sender already exists: ${displayName} (${senderPattern})`)
      continue
    }
    if (!adminUserId) {
      console.log("Skipping receipt senders: no admin user (set ADMIN_EMAILS or ADMIN_NPUBS and ensure that user exists).")
      break
    }
    await prisma.approvedReceiptSender.create({
      data: { senderPattern, displayName, addedBy: adminUserId },
    })
    console.log(`Added receipt sender: ${displayName} (${senderPattern})`)
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
