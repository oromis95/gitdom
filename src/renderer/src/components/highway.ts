// The choreography of GitDom's logo: six cars, like the changes of many authors, arrive in
// disorder, overtake and brake, until a light runs over the road and puts each one in its place.
// Pure numbers, without the DOM, so a test can check that the cars never touch.

export const LANE_H = 26
export const ROAD_Y = 10
export const ROAD_H = LANE_H * 6
export const WIDTH = 340
export const HEIGHT = ROAD_H + ROAD_Y * 2
export const CAR_W = 34
export const CAR_H = 16

/** Where the cars end, which is the logo: a row on the two middle lanes, in the graph's colors */
export const COLUMNS = [36, 90, 144, 198, 252, 306]
export const LANES = [2, 3, 2, 3, 2, 3]

/** The light, in ms and along the road: each car gets to its place as the light passes over it */
export const SWEEP = { start: 1900, end: 2800, from: -60, to: 400 }
const sweepAt = (x: number): number =>
  SWEEP.start + ((x - SWEEP.from) / (SWEEP.to - SWEEP.from)) * (SWEEP.end - SWEEP.start)
const PLACED = COLUMNS.map((x) => Math.round(sweepAt(x)))

/** When the last car is in its place, and when the startup animation ends */
export const SETTLED = Math.max(...PLACED)
export const DURATION = SWEEP.end

/** The waiting animation: the row holds, drives away from the front, and new cars come in */
const LEAVE = SETTLED + 450
const LEAVE_GAP = 70
const LEAVE_MS = 520
export const LOOP_DURATION = LEAVE + LEAVE_GAP * (COLUMNS.length - 1) + LEAVE_MS + 60

/** Off the road, on either side */
const BEFORE = -40
const AFTER = WIDTH + 50

type Key = [ms: number, value: number]

/** A car's way: its middle along the road, and its lane, at given times */
interface Route {
  x: Key[]
  lane: Key[]
  /** When its brake lights are on: while it slows down */
  brakes?: [from: number, to: number][]
  /** It drives off the road at the end, instead of stopping in its place */
  leaves?: boolean
}

/**
 * The disorder, until each car heads for its place. The cars come in by pairs, which meet on
 * three lanes: on lane 3, car 3 overtakes car 5 and cuts in, car 5 brakes, swerves, and later
 * races to the front; on lane 5, car 1 overtakes the slow car 0; on lane 1, car 2 brakes all of a
 * sudden, car 4 swerves at the last moment, passes and cuts across two lanes.
 */
const ROUTES: Route[] = [
  {
    x: [
      [100, BEFORE],
      [600, 50],
      [1400, 72]
    ],
    lane: [
      [400, 4],
      [700, 5],
      [1600, 5]
    ]
  },
  {
    x: [
      [350, BEFORE],
      [800, -3],
      [1150, 120],
      [1450, 165],
      [1800, 140]
    ],
    lane: [
      [700, 5],
      [950, 4],
      [1250, 4],
      [1500, 5],
      [1750, 5],
      [2000, 4]
    ]
  },
  {
    x: [
      [50, BEFORE],
      [600, 190],
      [1150, 245],
      [1550, 200],
      [1750, 192]
    ],
    lane: [
      [350, 2],
      [600, 1],
      [2000, 1]
    ],
    brakes: [[1160, 1350]]
  },
  {
    x: [
      [250, BEFORE],
      [700, 125],
      [1000, 232],
      [1200, 268],
      [1500, 280],
      [1900, 255]
    ],
    lane: [
      [600, 3],
      [830, 4],
      [1100, 4],
      [1330, 3]
    ]
  },
  {
    x: [
      [300, BEFORE],
      [800, 150],
      [1150, 178],
      [1450, 280],
      [1750, 305]
    ],
    lane: [
      [650, 0],
      [900, 1],
      [1100, 1],
      [1280, 0],
      [1500, 0],
      [1750, 2],
      [2100, 2]
    ]
  },
  {
    x: [
      [0, BEFORE],
      [450, 150],
      [1000, 215],
      [1150, 222],
      [1550, 175],
      [2250, 298]
    ],
    lane: [
      [0, 3],
      [1350, 3],
      [1600, 4],
      [2300, 4]
    ],
    brakes: [
      [1140, 1340],
      [2080, 2300]
    ]
  }
]

/** Each car ends in its place, as the light passes over it */
const arrive = (route: Route, car: number): Route => ({
  ...route,
  x: [...route.x, [PLACED[car], COLUMNS[car]]],
  lane: [...route.lane, [PLACED[car], LANES[car]]]
})

/** ...and, in the waiting animation, drives away after a while, the front cars first */
function leave(route: Route, car: number): Route {
  const start = LEAVE + LEAVE_GAP * (COLUMNS.length - 1 - car)
  return {
    ...route,
    x: [...route.x, [start, COLUMNS[car]], [start + LEAVE_MS, AFTER]],
    leaves: true
  }
}

/**
 * Monotone cubic interpolation (Fritsch–Carlson): smooth, and never beyond the keys. Still at the
 * first and last key, unless it's moving there: a car comes in at speed, and drives off speeding up.
 */
function curve(
  keys: Key[],
  moving: { first?: boolean; last?: boolean } = {}
): (ms: number) => number {
  const n = keys.length
  const secant = keys.slice(1).map(([t, v], i) => (v - keys[i][1]) / (t - keys[i][0]))
  const slope = keys.map((_, i) => {
    if (i === 0) return moving.first ? secant[0] : 0
    if (i === n - 1) return moving.last ? 2 * secant[n - 2] : 0
    const [a, b] = [secant[i - 1], secant[i]]
    if (a * b <= 0) return 0
    const [h0, h1] = [keys[i][0] - keys[i - 1][0], keys[i + 1][0] - keys[i][0]]
    const [w0, w1] = [2 * h1 + h0, h1 + 2 * h0]
    return (w0 + w1) / (w0 / a + w1 / b)
  })
  return (ms) => {
    if (ms <= keys[0][0]) return keys[0][1]
    if (ms >= keys[n - 1][0]) return keys[n - 1][1]
    let i = 0
    while (ms > keys[i + 1][0]) i++
    const [[t0, v0], [t1, v1]] = [keys[i], keys[i + 1]]
    const h = t1 - t0
    const s = (ms - t0) / h
    const s2 = s * s
    const s3 = s2 * s
    return (
      (2 * s3 - 3 * s2 + 1) * v0 +
      (s3 - 2 * s2 + s) * h * slope[i] +
      (-2 * s3 + 3 * s2) * v1 +
      (s3 - s2) * h * slope[i + 1]
    )
  }
}

export const laneY = (lane: number): number => ROAD_Y + lane * LANE_H + LANE_H / 2

/** Degrees of lean for each pixel per second sideways, and at most */
const LEAN = 0.08
const MAX_LEAN = 12
/** How long the brake lights take to come on, and to go off */
const BRAKE_ON = 50
const BRAKE_OFF = 120

function brakeLights(brakes: Route['brakes'] = [], ms: number): number {
  let light = 0
  for (const [from, to] of brakes) {
    if (ms < from || ms > to + BRAKE_OFF) continue
    light = Math.max(
      light,
      ms <= to ? Math.min(1, (ms - from) / BRAKE_ON) : 1 - (ms - to) / BRAKE_OFF
    )
  }
  return light
}

export interface CarPose {
  /** The car's middle */
  x: number
  y: number
  /** Degrees, clockwise: a car leans the way it changes lane */
  tilt: number
  /** How bright the brake lights are, 0 to 1 */
  brake: number
}

export type Drive = (ms: number) => CarPose

/** Where a car is at any time: it leans as much as it moves sideways. */
function drive(route: Route): Drive {
  const x = curve(route.x, { first: true, last: route.leaves })
  const lane = curve(route.lane)
  const y = (ms: number): number => laneY(lane(ms))
  return (ms) => {
    const sideways = ((y(ms + 8) - y(ms - 8)) / 16) * 1000
    return {
      x: x(ms),
      y: y(ms),
      tilt: Math.max(-MAX_LEAN, Math.min(MAX_LEAN, sideways * LEAN)),
      brake: brakeLights(route.brakes, ms)
    }
  }
}

/** The startup animation, ending in the logo */
export const SPLASH_CARS: Drive[] = ROUTES.map((r, car) => drive(arrive(r, car)))
/** The waiting animation, starting and ending with the cars off the road, to play in a loop */
export const LOOP_CARS: Drive[] = ROUTES.map((r, car) => drive(leave(arrive(r, car), car)))

/** The logo's cars, still */
export const PARKED: CarPose[] = COLUMNS.map((x, car) => ({
  x,
  y: laneY(LANES[car]),
  tilt: 0,
  brake: 0
}))

export const carTransform = ({ x, y, tilt }: CarPose): string =>
  `translate(${(x - CAR_W / 2).toFixed(2)}px, ${(y - CAR_H / 2).toFixed(2)}px) rotate(${tilt.toFixed(2)}deg)`

/** A frame every this many ms: the browser goes straight between them */
const FRAME = 20

/** Keyframes of a car and of its brake lights, for the Web Animations API */
export function carKeyframes(
  car: Drive,
  duration: number
): { body: Keyframe[]; brake: Keyframe[] } {
  const body: Keyframe[] = []
  const brake: Keyframe[] = []
  for (let ms = 0; ms <= duration; ms += FRAME) {
    const pose = car(ms)
    const offset = ms / duration
    body.push({ offset, transform: carTransform(pose) })
    brake.push({ offset, opacity: pose.brake.toFixed(2) })
  }
  return { body, brake }
}

/** Keyframes of the light running over the road */
export function sweepKeyframes(duration: number): Keyframe[] {
  const at = (ms: number): number => ms / duration
  return [
    { offset: 0, transform: `translateX(${SWEEP.from}px)` },
    { offset: at(SWEEP.start), transform: `translateX(${SWEEP.from}px)` },
    { offset: at(SWEEP.end), transform: `translateX(${SWEEP.to}px)` },
    { offset: 1, transform: `translateX(${SWEEP.to}px)` }
  ]
}
