// GitDom's settings file: the same gitdom.* keys and string values localStorage held up to 1.10.

export type StoredValues = Record<string, string>

/** What the main process hands the preload at startup. */
export interface StoredSettings {
  /** False until the file has been written once: the renderer then copies localStorage over. */
  exists: boolean
  values: StoredValues
}

export const SETTINGS_PREFIX = 'gitdom.'

/** The settings in `text`, or null when it isn't a JSON object of gitdom.* strings. */
export function parseStoredValues(text: string): StoredValues | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const values: StoredValues = {}
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith(SETTINGS_PREFIX) || typeof value !== 'string') return null
    values[key] = value
  }
  return values
}

/** The gitdom.* entries of a Storage, for the one-time move from localStorage to the file. */
export function legacyEntries(storage: Pick<Storage, 'length' | 'key' | 'getItem'>): StoredValues {
  const values: StoredValues = {}
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    const value = key === null ? null : storage.getItem(key)
    if (key?.startsWith(SETTINGS_PREFIX) && value !== null) values[key] = value
  }
  return values
}
