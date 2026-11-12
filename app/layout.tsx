import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import { Analytics } from "@vercel/analytics/next"
import { SessionProvider } from "@/components/session-provider"
import { ReturningUserCookie } from "@/components/returning-user-cookie"
import { NostrProfileSync } from "@/components/nostr-profile-sync"
import { PlatformProvider } from "@/lib/platform-context"
import { ServiceWorkerRegister } from "@/components/service-worker-register"
import "./globals.css"

// Checked-in files. next/font/google downloads CSS at build time, and Google
// sometimes returns extensionless /l/font URLs that Turbopack cannot resolve.
const spaceGrotesk = localFont({
  src: "./fonts/space-grotesk-latin.woff2",
  weight: "300 700",
  display: "swap",
})
const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono-latin.woff2",
  weight: "400 700",
  display: "swap",
  variable: "--font-jetbrains-mono",
})

export const metadata: Metadata = {
  title: "BitBudget - Bitcoin Opportunity Cost Tracker",
  description:
    "Track your spending and analyze the opportunity cost of your purchases--in Bitcoin terms. Budget smarter by understanding what your dollars could have been worth.",
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
