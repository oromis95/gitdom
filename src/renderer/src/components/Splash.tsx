// GitDom's logo: cars on a six-lane highway, like the changes of many authors. Animated, they
// arrive in disorder, overtake and brake, until a light runs over the road and puts each one in
// its place (the choreography is in highway.ts).
import { useEffect, useId, useRef, useState } from 'react'
import { laneColor } from '../graph/colors'
import {
  CAR_H,
  CAR_W,
  DURATION,
  HEIGHT,
  LANE_H,
  LOOP_CARS,
  LOOP_DURATION,
  PARKED,
  ROAD_H,
  ROAD_Y,
  SETTLED,
  SPLASH_CARS,
  SWEEP,
  WIDTH,
  carKeyframes,
  carTransform,
  sweepKeyframes
} from './highway'

const SWEEP_W = 70

export function HighwayLogo({
  size,
  animated = false,
  loop = false
}: {
  /** Width in pixels */
  size: number
  animated?: boolean
  /** New cars keep coming in disorder and getting in a row, instead of settling into the logo */
  loop?: boolean
}): React.JSX.Element {
  const carsRef = useRef<(SVGGElement | null)[]>([])
  const brakesRef = useRef<(SVGGElement | null)[]>([])
  const sweepRef = useRef<SVGRectElement | null>(null)
  const id = useId().replace(/[^\w-]/g, '')
  const moving = animated && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const cars = loop ? LOOP_CARS : SPLASH_CARS

  useEffect(() => {
    if (!moving) return
    const duration = loop ? LOOP_DURATION : DURATION
    const timing: KeyframeAnimationOptions = {
      duration,
      fill: 'forwards',
      iterations: loop ? Infinity : 1
    }
    const animations = cars.flatMap((car, i) => {
      const { body, brake } = carKeyframes(car, duration)
      return [
        carsRef.current[i]?.animate(body, timing),
        brakesRef.current[i]?.animate(brake, timing)
      ]
    })
    animations.push(sweepRef.current?.animate(sweepKeyframes(duration), timing))
    return () => animations.forEach((a) => a?.cancel())
  }, [moving, loop, cars])

  return (
    <svg
      className={`highway${moving ? ' animated' : ''}`}
      width={size}
      height={(size * HEIGHT) / WIDTH}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      aria-label="GitDom"
    >
      <defs>
        {/* The cars come in from under the road's edge */}
        <clipPath id={`${id}-road`}>
          <rect x={0} y={ROAD_Y} width={WIDTH} height={ROAD_H} rx={16} />
        </clipPath>
        <linearGradient id={`${id}-light`}>
          <stop offset={0} className="highway-light-edge" />
          <stop offset={0.5} className="highway-light-core" />
          <stop offset={1} className="highway-light-edge" />
        </linearGradient>
      </defs>
      <rect className="highway-road" x={0} y={ROAD_Y} width={WIDTH} height={ROAD_H} rx={16} />
      {[1, 2, 3, 4, 5].map((i) => (
        <line
          key={i}
          className="highway-dash"
          x1={0}
          x2={WIDTH}
          y1={ROAD_Y + i * LANE_H}
          y2={ROAD_Y + i * LANE_H}
        />
      ))}
      <g clipPath={`url(#${id}-road)`}>
        {moving && (
          <rect
            ref={sweepRef}
            x={-SWEEP_W / 2}
            y={ROAD_Y}
            width={SWEEP_W}
            height={ROAD_H}
            fill={`url(#${id}-light)`}
            style={{ transform: `translateX(${SWEEP.from}px)` }}
          />
        )}
        {cars.map((car, i) => (
          <g
            key={i}
            ref={(el) => {
              carsRef.current[i] = el
            }}
            className="highway-car"
            style={{ transform: carTransform(moving ? car(0) : PARKED[i]) }}
          >
            <rect width={CAR_W} height={CAR_H} rx={5} fill={laneColor(i)} />
            <rect x={5} y={3} width={5} height={CAR_H - 6} rx={1.5} fill="rgba(0, 0, 0, 0.28)" />
            <rect
              x={21}
              y={2.5}
              width={7}
              height={CAR_H - 5}
              rx={2}
              fill="rgba(255, 255, 255, 0.6)"
            />
            <g
              ref={(el) => {
                brakesRef.current[i] = el
              }}
              className="highway-brake"
              style={{ opacity: 0 }}
            >
              <rect x={0.8} y={2.2} width={3} height={4} rx={1.2} />
              <rect x={0.8} y={CAR_H - 6.2} width={3} height={4} rx={1.2} />
            </g>
          </g>
        ))}
      </g>
    </svg>
  )
}

/** How long the startup logo stays, before fading out; a click or a key skips it. */
const SPLASH_MS = DURATION + 700
const FADE_MS = 350

export default function Splash({ onDone }: { onDone: () => void }): React.JSX.Element {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setLeaving(true), SPLASH_MS)
    const skip = (): void => setLeaving(true)
    window.addEventListener('keydown', skip)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', skip)
    }
  }, [])

  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(onDone, FADE_MS)
    return () => clearTimeout(timer)
  }, [leaving, onDone])

  return (
    <div
      className={`splash${leaving ? ' leaving' : ''}`}
      style={{ '--settled': `${SETTLED}ms` } as React.CSSProperties}
      onMouseDown={() => setLeaving(true)}
    >
      <HighwayLogo size={400} animated />
      <div className="splash-title">GitDom</div>
      <div className="splash-tagline">Many authors, one flow</div>
    </div>
  )
}
