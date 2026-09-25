// Author pictures for the graph nodes (GRAPH-04): GitHub's for its noreply addresses, Gravatar's
// otherwise. Without network or picture, the node keeps its initials.

const GITHUB_NOREPLY = /^(\d+)\+[^@]+@users\.noreply\.github\.com$/i
const SIZE = 48

/** Address of the picture for an email: Gravatar answers 404 rather than a default image. */
export async function avatarUrl(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase()
  const github = GITHUB_NOREPLY.exec(normalized)
  if (github) return `https://avatars.githubusercontent.com/u/${github[1]}?s=${SIZE}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `https://www.gravatar.com/avatar/${hash}?s=${SIZE}&d=404`
}

// Loaded pictures, and null for the ones loading or missing: each email is asked for once
const images = new Map<string, HTMLImageElement | null>()
const listeners = new Set<() => void>()

/** The loaded picture for an email; starts loading it the first time. */
export function avatarImage(email: string): HTMLImageElement | null {
  const key = email.trim().toLowerCase()
  if (images.has(key)) return images.get(key)!
  images.set(key, null)
  void avatarUrl(key).then((url) => {
    const img = new Image()
    img.onload = () => {
      images.set(key, img)
      listeners.forEach((listener) => listener())
    }
    img.src = url
  })
  return null
}

/** Calls `listener` whenever a picture arrives; returns the unsubscribe function. */
export function onAvatarLoaded(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
