import type { Metadata, Viewport } from "next"
import { JetBrains_Mono, Space_Grotesk } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { SessionProvider } from "@/components/session-provider"
import { ReturningUserCookie } from "@/components/returning-user-cookie"
import { NostrProfileSync } from "@/components/nostr-profile-sync"
import { PlatformProvider } from "@/lib/platform-context"
import { ServiceWorkerRegister } from "@/components/service-worker-register"
import "./globals.css"

const spaceGrotesk = Space_Grotesk({ subsets: ["latin"] })
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jetbrains-mono",
})

export const metadata: Metadata = {
  title: "BitBudget - Bitcoin Opportunity Cost Tracker",
  description:
    "MIT-licensed Bitcoin-first envelope budgeting with opportunity cost tracking. Core budgeting is free; optional Premium on bitbudget.io covers bank sync and AI capture.",
  applicationName: "BitBudget",
  appleWebApp: {
    capable: true,
    title: "BitBudget",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: { url: "/icon.svg", type: "image/svg+xml" },
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
}

export const viewport: Viewport = {
  themeColor: "#0D0D0D",
  colorScheme: "dark",
  userScalable: true,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${spaceGrotesk.className} ${jetbrainsMono.variable} antialiased`}>
        <SessionProvider>
          <ServiceWorkerRegister />
          <ReturningUserCookie />
          <NostrProfileSync />
          <PlatformProvider>{children}</PlatformProvider>
        </SessionProvider>
        <Analytics />
      </body>
    </html>
  )
}
