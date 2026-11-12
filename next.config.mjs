import { withSentryConfig } from "@sentry/nextjs"

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Native addon; Turbopack cannot bundle it (js-binding is not ESM-placeable).
  // pdf-parse → pdfjs-dist: bundling breaks worker resolution ("Cannot find module ... pdf.worker.mjs").
  serverExternalPackages: ["@napi-rs/canvas", "pdf-parse", "pdfjs-dist"],
  images: {
    unoptimized: true,
  },
  // Allow loading dev app through ngrok (cross-origin /_next/* from ngrok host → localhost).
  allowedDevOrigins: [
    "*.ngrok-free.app",
    "*.ngrok-free.dev",
    "*.ngrok.io",
    "*.ngrok.app",
  ],
}

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
  automaticVercelMonitors: true,
})
