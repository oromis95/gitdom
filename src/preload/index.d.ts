import type { GitDomApi } from '../shared/api'

declare global {
  interface Window {
    api: GitDomApi
  }
}
