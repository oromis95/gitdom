// A path as its file's name, always readable, above its folder, which gives way from the start
// when the room runs out: the end of a folder is the part that tells it apart.

export default function FilePath({
  path,
  from,
  className
}: {
  /** A folder ends with "/", as git lists untracked and ignored folders */
  path: string
  /** The path before a rename */
  from?: string
  className?: string
}): React.JSX.Element {
  const folderEntry = path.endsWith('/')
  const trimmed = folderEntry ? path.slice(0, -1) : path
  const slash = trimmed.lastIndexOf('/')
  const name = trimmed.slice(slash + 1) + (folderEntry ? '/' : '')
  const folder = slash > 0 ? trimmed.slice(0, slash) : ''
  // Renamed in the same folder: the old name is enough
  const fromSlash = from ? from.lastIndexOf('/') : -1
  const old =
    from && from.slice(0, Math.max(fromSlash, 0)) === folder ? from.slice(fromSlash + 1) : from
  const below = [folder, old && `renamed from ${old}`].filter(Boolean).join(' · ')
  return (
    <span className={`path-cell${className ? ` ${className}` : ''}`} title={path}>
      <span className="path-name mono">{name}</span>
      {below && (
        <span className="path-folder">
          <bdi>{below}</bdi>
        </span>
      )}
    </span>
  )
}
