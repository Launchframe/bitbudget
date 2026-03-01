import NextAuth from "next-auth"
import { PrismaAdapter } from "@auth/prisma-adapter"
import Credentials from "next-auth/providers/credentials"
import Google from "next-auth/providers/google"
import GitHub from "next-auth/providers/github"
import { compareSync } from "bcryptjs"
import { prisma } from "@/lib/db"

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: {
    signIn: "/auth",
  },
  providers: [
    Credentials({
      id: "credentials",
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
        const email = credentials.email as string
        const password = credentials.password as string

        const user = await prisma.user.findUnique({ where: { email } })
        if (!user?.passwordHash) return null
        if (!compareSync(password, user.passwordHash)) return null

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
      },
      async authorize(credentials) {
        if (!credentials?.pubkey || !credentials?.event) return null
        const pubkey = credentials.pubkey as string
        const eventStr = credentials.event as string

        try {
          const { verifyEvent } = await import("nostr-tools")
          const event = JSON.parse(eventStr)
          const isValid = verifyEvent(event)
          if (!isValid) return null
          if (event.pubkey !== pubkey) return null

          let user = await prisma.user.findUnique({ where: { nostrPubkey: pubkey } })
          if (!user) {
            user = await prisma.user.create({
              data: {
                nostrPubkey: pubkey,
                name: `nostr:${pubkey.slice(0, 8)}`,
              },
            })
          }
          return { id: user.id, name: user.name, email: user.email, image: user.image }
        } catch {
          return null
        }
      },
    }),
    ...(process.env.AUTH_GOOGLE_ID
      ? [Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET! })]
      : []),
    ...(process.env.AUTH_GITHUB_ID
      ? [GitHub({ clientId: process.env.AUTH_GITHUB_ID, clientSecret: process.env.AUTH_GITHUB_SECRET! })]
      : []),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
      }
      return token
    },
    async session({ session, token }) {
      if (token?.id) {
        session.user.id = token.id as string
      }
      return session
    },
  },
})
