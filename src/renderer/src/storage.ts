// Where the renderer keeps its settings: the settings file in userData (main/settingsFile.ts),
// through the preload's synchronous copy. Use it instead of localStorage.
import { legacyEntries } from '../../shared/storedSettings'

export const storage = window.api.storage

// Up to 1.10 the settings lived in localStorage: the first run with the file brings them over,
// and leaves localStorage as it is, so an older GitDom still finds them
if (!storage.existed) {
  // eslint-disable-next-line no-restricted-globals
  for (const [key, value] of Object.entries(legacyEntries(localStorage))) {
    storage.setItem(key, value)
  }
}
