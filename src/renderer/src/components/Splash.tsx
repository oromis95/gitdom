// GitDom's logo: cars on a six-lane highway changing lanes without ever touching,
// like the changes of many authors flowing together through git.
import { useEffect, useRef, useState } from 'react'
import { laneColor } from '../graph/colors'

const LANE_H = 26
const ROAD_Y = 10
const ROAD_H = LANE_H * 6
const WIDTH = 340
const HEIGHT = ROAD_H + ROAD_Y * 2
const CAR_W = 34
const CAR_H = 16

/** Each car keeps its own column, more than a car length apart: whatever lanes they take, they cannot touch */
const COLUMNS = [36, 90, 144, 198, 252, 306]

/** Lane of each car at each step; the last step, merged into the middle lanes, is the static logo */
const STEPS = [
  [0, 1, 2, 3, 4, 5],
  [5, 3, 1, 4, 2, 0],
  [1, 0, 4, 2, 5, 3],
  [2, 3, 2, 3, 2, 3]
]

/** Timeline, in ms: each step is held, then every car moves to its next lane, one after the other */
const HOLD = 250
const MOVE = 480
const STAGGER = 45
const DURATION = HOLD + (STEPS.length - 1) * (MOVE + HOLD) + STAGGER * COLUMNS.length

const laneY = (lane: number): number => ROAD_Y + lane * LANE_H + LANE_H / 2

function carTransform(car: number, lane: number, tilt = 0): string {
  const x = COLUMNS[car] - CAR_W / 2
  const y = laneY(lane) - CAR_H / 2
  return `translate(${x}px, ${y}px) rotate(${tilt}deg)`
}

/** Keyframes of one car: it leans into each lane change, then straightens up. */
function carKeyframes(car: number): Keyframe[] {
  const frames: Keyframe[] = [{ offset: 0, transform: carTransform(car, STEPS[0][car]) }]
  for (let step = 1; step < STEPS.length; step++) {
    const from = STEPS[step - 1][car]
    const to = STEPS[step][car]
    const start = HOLD + (step - 1) * (MOVE + HOLD) + car * STAGGER
    const tilt = Math.sign(to - from) * 9
    frames.push(
      { offset: start / DURATION, transform: carTransform(car, from), easing: 'ease-in' },
      {
        offset: (start + MOVE / 2) / DURATION,
        transform: carTransform(car, (from + to) / 2, tilt),
        easing: 'ease-out'
      },
      { offset: (start + MOVE) / DURATION, transform: carTransform(car, to) }
    )
  }
  frames.push({ offset: 1, transform: carTransform(car, STEPS[STEPS.length - 1][car]) })
  return frames
}

export function HighwayLogo({
  size,
  animated = false
}: {
  /** Width in pixels */
  size: number
  animated?: boolean
}): React.JSX.Element {
  const carsRef = useRef<(SVGGElement | null)[]>([])

  useEffect(() => {
    if (!animated) return
    const animations = carsRef.current.map((car, i) =>
      car?.animate(carKeyframes(i), { duration: DURATION, fill: 'forwards' })
    )
    return () => animations.forEach((a) => a?.cancel())
  }, [animated])

  const last = STEPS[STEPS.length - 1]
  return (
    <svg
      className={`highway${animated ? ' animated' : ''}`}
      width={size}
      height={(size * HEIGHT) / WIDTH}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      aria-label="GitDom"
    >
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
      {COLUMNS.map((_, i) => (
        <g
          key={i}
          ref={(el) => {
            carsRef.current[i] = el
          }}
          className="highway-car"
          style={{ transform: carTransform(i, animated ? STEPS[0][i] : last[i]) }}
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
        </g>
      ))}
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
    <div className={`splash${leaving ? ' leaving' : ''}`} onMouseDown={() => setLeaving(true)}>
      <HighwayLogo size={400} animated />
      <div className="splash-title">GitDom</div>
      <div className="splash-tagline">Many authors, one flow</div>
    </div>
  )
}
