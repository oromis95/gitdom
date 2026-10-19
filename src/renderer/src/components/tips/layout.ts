// Where things go on the stage of the tips, and when they show up.

export const ROW = 30
export const top = (i: number): number => 20 + i * ROW

/** Shown from a moment of the loop on (ta-from-N), or until one (ta-until-N): timeline.css */
export const from = (n: number): string => `ta-from-${n}`
export const until = (n: number): string => `ta-until-${n}`
