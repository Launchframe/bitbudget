"use client"

import { useEffect, useRef } from "react"

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  rotation: number
  spin: number
  size: number
  kind: "bill" | "btc"
}

interface IncomeSuccessParticlesProps {
  opportunityCostEnabled: boolean
}

export function IncomeSuccessParticles({ opportunityCostEnabled }: IncomeSuccessParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (typeof window === "undefined") return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener("resize", resize)

    const count = 90
    const particles: Particle[] = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 1.2,
      vy: 1.5 + Math.random() * 2,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.08,
      size: 12 + Math.random() * 16,
      kind: opportunityCostEnabled ? "btc" : "bill",
    }))

    let frame = 0
    const tick = () => {
      frame += 1
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const p of particles) {
        if (p.kind === "btc") {
          p.vy += 0.04
        } else {
          p.x += Math.sin(frame * 0.02 + p.y * 0.01) * 0.8
        }
        p.x += p.vx
        p.y += p.vy
        p.rotation += p.spin

        if (p.y > canvas.height + 40) {
          p.y = -20
          p.x = Math.random() * canvas.width
          p.vy = p.kind === "btc" ? 1 + Math.random() : 1.5 + Math.random() * 2
        }

        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rotation)
        if (p.kind === "btc") {
          ctx.fillStyle = "#F7931A"
          ctx.beginPath()
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = "#0D0D0D"
          ctx.font = `bold ${p.size * 0.45}px sans-serif`
          ctx.textAlign = "center"
          ctx.textBaseline = "middle"
          ctx.fillText("₿", 0, 1)
        } else {
          ctx.fillStyle = "#22C55E"
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.55)
          ctx.strokeStyle = "#14532d"
          ctx.strokeRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.55)
          ctx.fillStyle = "#14532d"
          ctx.font = `bold ${p.size * 0.35}px sans-serif`
          ctx.textAlign = "center"
          ctx.fillText("$", 0, 2)
        }
        ctx.restore()
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      window.removeEventListener("resize", resize)
      cancelAnimationFrame(rafRef.current)
    }
  }, [opportunityCostEnabled])

  if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return null
  }

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-50"
      aria-hidden
    />
  )
}
