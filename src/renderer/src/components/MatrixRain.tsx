// Falling code behind the welcome screen, in the Matrix theme. Still, when the system asks for
// reduced motion.
import { useEffect, useRef } from 'react'

const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF<>/*+-=:'
const SIZE = 16
const FRAME_MS = 55

export default function MatrixRain(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let drops: number[] = []
    const resize = (): void => {
      canvas.width = canvas.clientWidth
      canvas.height = canvas.clientHeight
      drops = Array.from({ length: Math.ceil(canvas.width / SIZE) }, () =>
        Math.floor((Math.random() * canvas.height) / SIZE)
      )
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    const step = (): void => {
      // Fading what was drawn leaves the trails
      ctx.fillStyle = 'rgba(0, 0, 0, 0.08)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.font = `${SIZE}px Consolas, monospace`
      drops.forEach((row, column) => {
        const glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
        ctx.fillStyle = Math.random() < 0.03 ? '#e0ffe8' : '#00ff41'
        ctx.fillText(glyph, column * SIZE, row * SIZE)
        drops[column] = row * SIZE > canvas.height && Math.random() > 0.975 ? 0 : row + 1
      })
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (let i = 0; i < 40; i++) step()
      return () => observer.disconnect()
    }
    const timer = setInterval(step, FRAME_MS)
    return () => {
      clearInterval(timer)
      observer.disconnect()
    }
  }, [])

  return <canvas ref={canvasRef} className="matrix-rain" aria-hidden />
}
