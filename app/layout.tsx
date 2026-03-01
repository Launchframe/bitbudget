import type { Metadata, Viewport } from "next"
import { Space_Grotesk } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { SessionProvider } from "@/components/session-provider"
import "./globals.css"

const spaceGrotesk = Space_Grotesk({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "BitBudget - Bitcoin Opportunity Cost Tracker",
  description:
    "Track your spending and analyze the opportunity cost of your purchases in Bitcoin. Budget smarter by understanding what your dollars could have been worth.",
  icons: {
    icon: { url: "/icon.svg", type: "image/svg+xml" },
    apple: "/apple-icon.svg",
  },
}

export const viewport: Viewport = {
  themeColor: "#F7931A",
  userScalable: true,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${spaceGrotesk.className} antialiased`}>
        <SessionProvider>{children}</SessionProvider>
        <Analytics />
      </body>
    </html>
  )
}
