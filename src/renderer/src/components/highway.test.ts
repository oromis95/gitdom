import { describe, expect, it } from 'vitest'
import {
  CAR_H,
  CAR_W,
  COLUMNS,
  DURATION,
  LANES,
  LOOP_CARS,
  LOOP_DURATION,
  PARKED,
  ROAD_H,
  ROAD_Y,
  SPLASH_CARS,
  SWEEP,
  WIDTH,
  laneY,
  type CarPose,
  type Drive
} from './highway'

/** Half the width and height of the box around a car, leaning or not */
function halfBox({ tilt }: CarPose): [number, number] {
  const angle = (Math.abs(tilt) * Math.PI) / 180
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)]
  return [(CAR_W * cos + CAR_H * sin) / 2, (CAR_W * sin + CAR_H * cos) / 2]
}

const offRoad = (p: CarPose): boolean => p.x + CAR_W / 2 <= 0 || p.x - CAR_W / 2 >= WIDTH

function* frames(cars: Drive[], duration: number): Generator<[number, CarPose[]]> {
  for (let ms = 0; ms <= duration; ms += 5) yield [ms, cars.map((car) => car(ms))]
}

/** How much a car speeds up, in pixels per second squared: less than 0 while it slows down */
function speedingUp(car: Drive, ms: number): number {
  const speed = (at: number): number => ((car(at + 5).x - car(at - 5).x) / 10) * 1000
  return ((speed(ms + 10) - speed(ms - 10)) / 20) * 1000
}

describe.each([
  ['startup', SPLASH_CARS, DURATION],
  ['waiting', LOOP_CARS, LOOP_DURATION]
])('the %s animation', (_, cars, duration) => {
  it('never lets two cars touch', () => {
    const touching: string[] = []
    for (const [ms, poses] of frames(cars, duration))
      for (let i = 0; i < poses.length; i++)
        for (let j = i + 1; j < poses.length; j++) {
          const [a, b] = [poses[i], poses[j]]
          if (offRoad(a) || offRoad(b)) continue
          const [aw, ah] = halfBox(a)
          const [bw, bh] = halfBox(b)
          const gap = Math.max(Math.abs(a.x - b.x) - aw - bw, Math.abs(a.y - b.y) - ah - bh)
          if (gap < 2) touching.push(`${ms}ms: cars ${i} and ${j}`)
        }
    expect(touching).toEqual([])
  })

  it('keeps the cars on the road', () => {
    for (const [, poses] of frames(cars, duration))
      for (const pose of poses) {
        const [, h] = halfBox(pose)
        expect(pose.y - h).toBeGreaterThanOrEqual(ROAD_Y)
        expect(pose.y + h).toBeLessThanOrEqual(ROAD_Y + ROAD_H)
      }
  })

  it('lights the brakes only while a car slows down', () => {
    let lit = 0
    for (const car of cars)
      for (let ms = 0; ms <= duration; ms += 5)
        if (car(ms).brake === 1) {
          lit++
          expect(speedingUp(car, ms)).toBeLessThan(0)
        }
    expect(lit).toBeGreaterThan(0)
  })

  it('starts with the cars off the road, coming in from the left', () => {
    for (const car of cars) expect(car(0).x + CAR_W / 2).toBeLessThanOrEqual(0)
  })
})

describe('the startup animation', () => {
  const round = (pose: CarPose): CarPose => ({
    x: Math.round(pose.x * 100) / 100,
    y: Math.round(pose.y * 100) / 100,
    tilt: Math.round(pose.tilt * 100) / 100 + 0,
    brake: pose.brake
  })

  it('ends in the logo', () => {
    expect(SPLASH_CARS.map((car) => round(car(DURATION)))).toEqual(PARKED)
  })

  it('puts each car in its place as the light passes over it', () => {
    COLUMNS.forEach((x, i) => {
      const passing =
        SWEEP.start + ((x - SWEEP.from) / (SWEEP.to - SWEEP.from)) * (SWEEP.end - SWEEP.start)
      const car = SPLASH_CARS[i]
      expect(round(car(passing + 10))).toEqual(PARKED[i])
      const before = car(passing - 120)
      expect(Math.abs(before.x - x) + Math.abs(before.y - laneY(LANES[i]))).toBeGreaterThan(1)
    })
  })
})

describe('the waiting animation', () => {
  it('starts as it ends, with the cars off the road, so it can play in a loop', () => {
    for (const car of LOOP_CARS)
      expect(car(LOOP_DURATION).x - CAR_W / 2).toBeGreaterThanOrEqual(WIDTH)
  })
})
