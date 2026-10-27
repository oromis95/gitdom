// Descriptions and comments of pull requests, drawn from parsed Markdown: no HTML is ever set.
import { useMemo } from 'react'
import { parseBlocks, type MdBlock, type Span } from '../../../../shared/markdown'
import { openInBrowser } from '../../forge'

function Spans({ spans }: { spans: Span[] }): React.JSX.Element {
  return (
    <>
      {spans.map((s, i) => {
        let node: React.ReactNode = s.code ? <code>{s.text}</code> : s.text
        if (s.bold) node = <b>{node}</b>
        if (s.italic) node = <i>{node}</i>
        if (s.strike) node = <s>{node}</s>
        if (s.href) {
          const href = s.href
          node = (
            <a
              href={href}
              title={href}
              className={s.image ? 'md-image' : undefined}
              onClick={(e) => {
                e.preventDefault()
                openInBrowser(href)
              }}
            >
              {s.image ? `🖼 ${s.text}` : node}
            </a>
          )
        }
        return <span key={i}>{node}</span>
      })}
    </>
  )
}

function Block({ block }: { block: MdBlock }): React.JSX.Element {
  switch (block.kind) {
    case 'heading':
      return (
        <div className={`md-heading md-h${block.level}`}>
          <Spans spans={block.text} />
        </div>
      )
    case 'paragraph':
      return (
        <p>
          <Spans spans={block.text} />
        </p>
      )
    case 'item':
      return (
        <div className="md-item" style={{ marginLeft: block.depth * 18 }}>
          <span className="md-bullet">
            {block.checked !== null ? (
              <input type="checkbox" checked={block.checked} readOnly tabIndex={-1} />
            ) : block.ordered !== null ? (
              `${block.ordered}.`
            ) : (
              '•'
            )}
          </span>
          <span>
            <Spans spans={block.text} />
          </span>
        </div>
      )
    case 'code':
      return <pre className="md-code">{block.text}</pre>
    case 'quote':
      return (
        <blockquote className="md-quote">
          {block.blocks.map((b, i) => (
            <Block key={i} block={b} />
          ))}
        </blockquote>
      )
    case 'table':
      return (
        <div className="md-table">
          <table>
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th key={i}>
                    <Spans spans={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, i) => (
                    <td key={i}>
                      <Spans spans={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'rule':
      return <hr />
  }
}

export default function Markdown({ text }: { text: string }): React.JSX.Element {
  const blocks = useMemo(() => parseBlocks(text), [text])
  return (
    <div className="markdown pull-markdown">
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  )
}
