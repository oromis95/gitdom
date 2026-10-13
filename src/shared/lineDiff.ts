// Line diff (Myers' O(ND) algorithm) between two versions of a file, each line given as a number:
// equal lines have equal numbers. Used by the time-lapse to carry each line's identity from one
// version to the next.

/** Beyond this many differences the rest is taken as removed and added again: too slow to align. */
const MAX_EDITS = 4000

/**
 * For each line of `b`, the index of the equal line of `a` it comes from, or -1 for an added line.
 * Lines of `a` that no line of `b` points to were removed.
 */
export function matchLines(a: ArrayLike<number>, b: ArrayLike<number>): Int32Array {
  const match = new Int32Array(b.length).fill(-1)
  // The common start and end need no search
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) {
    match[start] = start
    start++
  }
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    match[--endB] = --endA
  }
  const n = endA - start
  const m = endB - start
  if (n === 0 || m === 0) return match

  const max = Math.min(n + m, MAX_EDITS)
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  // v after each round d, to walk back the path once the end is reached
  const trace: Int32Array[] = []
  let found = -1
  for (let d = 0; d <= max && found < 0; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[start + x] === b[start + y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        found = d
        break
      }
    }
    trace.push(v.slice())
  }
  // Too different: nothing in the middle is kept
  if (found < 0) return match

  let x = n
  let y = m
  for (let d = found; d > 0; d--) {
    const prev = trace[d - 1]
    const k = x - y
    // Whether round d got to diagonal k by adding a line of b (down) or removing one of a
    const down = k === -d || (k !== d && prev[offset + k - 1] < prev[offset + k + 1])
    const prevK = down ? k + 1 : k - 1
    const prevX = prev[offset + prevK]
    const prevY = prevX - prevK
    // The equal lines after that edit
    while (x > prevX && y > prevY) {
      x--
      y--
      match[start + y] = start + x
    }
    x = prevX
    y = prevY
  }
  // The diagonal from the start, before the first edit
  while (x > 0 && y > 0) {
    x--
    y--
    match[start + y] = start + x
  }
  return match
}
