// Matches paths against the Git LFS patterns of the root .gitattributes, like git does.

function patternRegex(pattern: string): RegExp {
  // Without a slash the pattern matches the name at any depth; with one, from the root
  const anchored = pattern.replace(/\/+$/, '').includes('/')
  const glob = pattern.replace(/^\//, '')
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (glob.startsWith('**/', i)) {
      source += '(?:.*/)?'
      i += 2
    } else if (glob.startsWith('/**', i) && i + 3 === glob.length) {
      source += '/.*'
      i += 2
    } else if (c === '*') {
      source += '[^/]*'
    } else if (c === '?') {
      source += '[^/]'
    } else if (c === '[') {
      const end = glob.indexOf(']', i + 2)
      if (end < 0) source += '\\['
      else {
        source +=
          '[' +
          glob
            .slice(i + 1, end)
            .replace(/^!/, '^')
            .replace(/\\/g, '\\\\') +
          ']'
        i = end
      }
    } else {
      source += c.replace(/[.+^${}()|\\]/g, '\\$&')
    }
  }
  return new RegExp(anchored ? `^${source}$` : `(?:^|/)${source}$`)
}

/** Tells whether a repository-relative path is stored with LFS; the last matching pattern wins in git, but LFS patterns only add. */
export function lfsMatcher(patterns: string[]): (path: string) => boolean {
  const regexes = patterns.flatMap((p) => {
    try {
      return [patternRegex(p)]
    } catch {
      return []
    }
  })
  return (path) => regexes.some((re) => re.test(path))
}
