import NextAuth from "next-auth"
import { PrismaAdapter } from "@auth/prisma-adapter"
import Credentials from "next-auth/providers/credentials"
import Google from "next-auth/providers/google"
import GitHub from "next-auth/providers/github"
import { prisma } from "@/lib/db"
import { computeNostrProfileUpdates, sanitizeNostrProfileImage, sanitizeNostrProfileName } from "@/lib/nostr-profile"
import { parseNostrAuthEvent } from "@/lib/sign-in-methods"

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: {
    signIn: "/auth",
    error: "/auth/error",
  },
  providers: [
    Credentials({
      id: "email-code",
      name: "Email Code",
      credentials: {
        email: { label: "Email", type: "email" },
        code: { label: "Code", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.code) return null
        const email = (credentials.email as string).toLowerCase().trim()
        const code = credentials.code as string

        const record = await prisma.emailCode.findFirst({
          where: { email, code, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
        })
        if (!record) return null

        await prisma.emailCode.deleteMany({ where: { email } })

        let user = await prisma.user.findUnique({ where: { email } })
        if (!user) {
          user = await prisma.user.create({
            data: { email, emailVerified: new Date(), name: email.split("@")[0] },
          })
        } else if (!user.emailVerified) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { emailVerified: new Date() },
          })
        }

        return { id: user.id, name: user.name, email: user.email, image: user.image }
      },
    }),
    Credentials({
      id: "nostr",
      name: "Nostr",
      credentials: {
        pubkey: { label: "Public Key", type: "text" },
        sig: { label: "Signature", type: "text" },
        event: { label: "Signed Event", type: "text" },
        profileName: { label: "Profile Name", type: "text" },
        profileImage: { label: "Profile Image", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.pubkey || !credentials?.event) return null
        const pubkey = (credentials.pubkey as string).trim().toLowerCase()
        const eventStr = credentials.event as string
        const profileName = (credentials.profileName as string) || ""
        const profileImage = (credentials.profileImage as string) || ""
        const sanitizedProfile = {
          name: sanitizeNostrProfileName(profileName),
          image: sanitizeNostrProfileImage(profileImage),
        }

        try {
          const parsedEvent = parseNostrAuthEvent(eventStr, pubkey)
          const { verifyEvent } = await import("nostr-tools")
          const isValid = verifyEvent(parsedEvent)
          if (!isValid) return null

          let user = await prisma.user.findUnique({ where: { nostrPubkey: pubkey } })
          if (!user) {
            user = await prisma.user.create({
              data: {
                nostrPubkey: pubkey,
                name: sanitizedProfile.name || `nostr:${pubkey.slice(0, 8)}`,
                image: sanitizedProfile.image || null,
              },
            })
          } else {
            const updates = computeNostrProfileUpdates(user, sanitizedProfile)
            if (updates) {
              user = await prisma.user.update({ where: { id: user.id }, data: updates })
            }
          }
          return { id: user.id, name: user.name, email: user.email, image: user.image }
        } catch {
          return null
        }
      },
    }),
    ...(process.env.GOOGLE_CLIENT_ID
      ? [Google({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET! })]
      : []),
    ...(process.env.GITHUB_CLIENT_ID
      ? [GitHub({ clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET! })]
      : []),
  ],
  events: {
    async signIn({ user }) {
      if (typeof user?.id !== "string") return
      try {
        const { ensureSystemSavingsEnvelope } = await import("@/lib/ensure-system-savings-envelope")
        await ensureSystemSavingsEnvelope(user.id)
      } catch {
        /* non-fatal — envelope ensure retried on funding/import paths */
      }
    },
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id
        token.name = user.name ?? undefined
        token.picture = user.image ?? undefined
      }
      if (trigger === "update" && session) {
        const next = session as { name?: string; image?: string }
        if (typeof next.name === "string") token.name = next.name
        if (typeof next.image === "string") token.picture = next.image
      }
      return token
    },
    async session({ session, token }) {
      if (token?.id) {
        session.user.id = token.id as string
      }
      if (typeof token?.name === "string") {
        session.user.name = token.name
      }
      if (typeof token?.picture === "string") {
        session.user.image = token.picture
      }
      return session
    },
  },
})
