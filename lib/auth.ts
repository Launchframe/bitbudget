import NextAuth from "next-auth"
import { PrismaAdapter } from "@auth/prisma-adapter"
import Credentials from "next-auth/providers/credentials"
import Google from "next-auth/providers/google"
import GitHub from "next-auth/providers/github"
import { prisma } from "@/lib/db"
import { ensureSystemSavingsEnvelope } from "@/lib/envelope-funding"

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
            data: { email, name: email.split("@")[0] },
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

        try {
          const { verifyEvent } = await import("nostr-tools")
          const event = JSON.parse(eventStr)
          const isValid = verifyEvent(event)
          if (!isValid) return null
          if (typeof event.pubkey !== "string" || event.pubkey.toLowerCase() !== pubkey) return null

          let user = await prisma.user.findUnique({ where: { nostrPubkey: pubkey } })
          if (!user) {
            user = await prisma.user.create({
              data: {
                nostrPubkey: pubkey,
                name: profileName || `nostr:${pubkey.slice(0, 8)}`,
                image: profileImage || null,
              },
            })
          } else if (profileName || profileImage) {
            const updates: { name?: string; image?: string } = {}
            if (profileName && user.name?.startsWith("nostr:")) updates.name = profileName
            if (profileImage && user.image !== profileImage) updates.image = profileImage
            if (Object.keys(updates).length > 0) {
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
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.picture = user.image ?? undefined
      }
      return token
    },
    async session({ session, token }) {
      if (token?.id) {
        session.user.id = token.id as string
        void ensureSystemSavingsEnvelope(token.id as string).catch(() => {})
      }
      if (token?.picture) {
        session.user.image = token.picture as string
      }
      return session
    },
  },
})
