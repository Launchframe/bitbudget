/** @type {import('next').NextConfig} */
const nextConfig = {
  // Native addon; Turbopack cannot bundle it (js-binding is not ESM-placeable).
  serverExternalPackages: ["@napi-rs/canvas"],
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

export default nextConfig
