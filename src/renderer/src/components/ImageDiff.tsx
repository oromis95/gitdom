// Image comparison (DIFF-06): side by side, overlaid with an opacity slider, or with a swipe.
import { useEffect, useState } from 'react'
import type { Result } from '../../../shared/api'
import type { DiffSource, ImagePair } from '../../../shared/types'

type Mode = 'side' | 'overlay' | 'swipe'

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'side', label: 'Side by side' },
  { mode: 'overlay', label: 'Overlay' },
  { mode: 'swipe', label: 'Swipe' }
]

interface Size {
  width: number
  height: number
}

function Picture({
  src,
  label,
  onSize
}: {
  src: string | null
  label: string
  onSize: (size: Size) => void
}): React.JSX.Element {
  return (
    <figure className="image-side">
      <figcaption>{label}</figcaption>
      {src ? (
        <img
          src={src}
          alt={label}
          onLoad={(e) =>
            onSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })
          }
        />
      ) : (
        <div className="image-missing">None</div>
      )}
    </figure>
  )
}

export default function ImageDiff({
  repo,
  source,
  path,
  oldPath,
  reloadToken
}: {
  repo: string
  source: DiffSource
  path: string
  oldPath?: string
  /** Changes when the working tree changes, so the images are loaded again */
  reloadToken: unknown
}): React.JSX.Element {
  const key = JSON.stringify([source, path, oldPath])
  const [loaded, setLoaded] = useState<{ key: string; result: Result<ImagePair> } | null>(null)
  const [mode, setMode] = useState<Mode>('side')
  const [amount, setAmount] = useState(50)
  const [sizes, setSizes] = useState<{ before?: Size; after?: Size }>({})

  useEffect(() => {
    let cancelled = false
    void window.api.op(repo, 'imagePair', source, path, oldPath).then((result) => {
      if (!cancelled) setLoaded({ key, result })
    })
    return () => {
      cancelled = true
    }
    // source/path are covered by key; reloadToken is a deliberate trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, key, reloadToken])

  if (!loaded || loaded.key !== key) return <div className="center-message">Loading…</div>
  if (!loaded.result.ok) return <div className="banner-error">{loaded.result.error}</div>
  const { before, after } = loaded.result.value
  const both = !!before && !!after
  const shown = both ? mode : 'side'
  const describe = (size?: Size): string => (size ? ` · ${size.width}×${size.height}` : '')

  return (
    <div className="image-diff">
      {both && (
        <div className="image-toolbar">
          <span className="segmented">
            {MODES.map((m) => (
              <button
                key={m.mode}
                className={mode === m.mode ? 'active' : ''}
                onClick={() => setMode(m.mode)}
              >
                {m.label}
              </button>
            ))}
          </span>
          {mode !== 'side' && (
            <label>
              {mode === 'overlay' ? 'Opacity of the new image' : 'Position'}
              <input
                type="range"
                min={0}
                max={100}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
              />
            </label>
          )}
        </div>
      )}
      {shown === 'side' ? (
        <div className="image-pair">
          <Picture
            src={before}
            label={`Before${describe(sizes.before)}`}
            onSize={(before) => setSizes((s) => ({ ...s, before }))}
          />
          <Picture
            src={after}
            label={`After${describe(sizes.after)}`}
            onSize={(after) => setSizes((s) => ({ ...s, after }))}
          />
        </div>
      ) : (
        <div className="image-stack checkerboard">
          <img src={before!} alt="Before" />
          <img
            src={after!}
            alt="After"
            style={
              shown === 'overlay'
                ? { opacity: amount / 100 }
                : { clipPath: `inset(0 0 0 ${amount}%)` }
            }
          />
          {shown === 'swipe' && <div className="image-swipe-line" style={{ left: `${amount}%` }} />}
        </div>
      )}
    </div>
  )
}
