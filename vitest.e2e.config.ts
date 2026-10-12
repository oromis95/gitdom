import { defineConfig } from 'vitest/config'

// The end-to-end tests drive the built app: `npm run test:e2e` builds it first
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.ts'],
    testTimeout: 60000,
    hookTimeout: 120000,
    // One GitDom window at a time: they would fight over focus and the keyboard
    fileParallelism: false
  }
})
