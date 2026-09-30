import { createElement, ReactNode } from 'react'

const allowedHtmlTags = new Set(['a', 'b', 'blockquote', 'br', 'code', 'del', 'details', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'kbd', 'li', 'ol', 'p', 'pre', 's', 'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul'])
const discardedHtmlTags = new Set(['iframe', 'object', 'script', 'style', 'svg', 'math', 'video', 'audio'])
const blockHtmlTags = new Set(['blockquote', 'details', 'div', 'ol', 'p', 'pre', 'section', 'table', 'ul'])

function safeLink(value: string): string | null {
  try {
    const url = new URL(value, window.location.origin)
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null
  } catch { return null }
}

function renderHtmlNode(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent
  if (!(node instanceof Element)) return null
  const tag = node.tagName.toLocaleLowerCase()
  if (discardedHtmlTags.has(tag)) return null
  if (tag === 'img') {
    const src = safeLink(node.getAttribute('src') ?? '')
    if (!src || !src.startsWith('https:')) return null
    return <img key={key} src={src} alt={node.getAttribute('alt') ?? ''} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
  }
  const children = Array.from(node.childNodes).map((child, index) => renderHtmlNode(child, `${key}-${index}`))
  if (!allowedHtmlTags.has(tag)) return <span key={key}>{children}</span>
  const props: Record<string, unknown> = { key }
  if (tag === 'a') {
    const href = safeLink(node.getAttribute('href') ?? '')
    if (href) { props.href = href; props.target = '_blank'; props.rel = 'noreferrer' }
  }
  if (tag === 'ol') {
    const start = Number(node.getAttribute('start'))
    if (Number.isSafeInteger(start) && start > 1) props.start = start
  }
  if (tag === 'td' || tag === 'th') {
    const colSpan = Number(node.getAttribute('colspan'))
    const rowSpan = Number(node.getAttribute('rowspan'))
    if (Number.isSafeInteger(colSpan) && colSpan > 0 && colSpan <= 20) props.colSpan = colSpan
    if (Number.isSafeInteger(rowSpan) && rowSpan > 0 && rowSpan <= 20) props.rowSpan = rowSpan
  }
  if (tag === 'details' && node.hasAttribute('open')) props.open = true
  const alignment = node.getAttribute('align')?.toLocaleLowerCase()
  if (['left', 'center', 'right', 'justify'].includes(alignment ?? '')) props.style = { textAlign: alignment }
  const safeTag = tag === 'b' ? 'strong' : tag === 'i' ? 'em' : tag === 's' ? 'del' : tag
  return createElement(safeTag, props, ...children)
}

function renderHtml(markup: string, key: string): ReactNode[] {
  const document = new DOMParser().parseFromString(markup, 'text/html')
  return Array.from(document.body.childNodes).map((node, index) => renderHtmlNode(node, `${key}-${index}`))
}

function renderInline(text: string, line: number): ReactNode[] {
  const tokenPattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|<([a-z][\w-]*)\b[^>]*>[\s\S]*?<\/\2\s*>|<(?:br|hr|img)\b[^>]*\/?>)/gi
  const output: ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = tokenPattern.exec(text))) {
    if (match.index > cursor) output.push(text.slice(cursor, match.index))
    const token = match[0]
    const key = `${line}-${match.index}`
    if (token.startsWith('<')) output.push(...renderHtml(token, key))
    else if (token.startsWith('`')) output.push(<code key={key}>{token.slice(1, -1)}</code>)
    else if (token.startsWith('**')) output.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      const href = link ? safeLink(link[2]) : null
      output.push(href && link ? <a key={key} href={href} target="_blank" rel="noreferrer">{link[1]}</a> : <span key={key}>{link?.[1] ?? token}</span>)
    }
    cursor = tokenPattern.lastIndex
  }
  if (cursor < text.length) output.push(text.slice(cursor))
  return output
}

export default function ProjectReadmePreview({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()
    if (!trimmed) { index += 1; continue }
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      const marker = trimmed.slice(0, 3)
      const code: string[] = []
      const start = index
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith(marker)) code.push(lines[index++])
      if (index < lines.length) index += 1
      blocks.push(<pre key={`code-${start}`}><code>{code.join('\n')}</code></pre>)
      continue
    }
    const htmlRoot = trimmed.match(/^<(blockquote|details|div|ol|p|pre|section|table|ul)\b[^>]*>$/i)
    if (htmlRoot && blockHtmlTags.has(htmlRoot[1].toLocaleLowerCase())) {
      const tag = htmlRoot[1]
      const tagPattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi')
      const htmlLines: string[] = []
      let depth = 0
      const start = index
      while (index < lines.length) {
        const current = lines[index++]
        htmlLines.push(current)
        for (const found of current.matchAll(tagPattern)) {
          const token = found[0]
          if (/^<\//.test(token)) depth -= 1
          else if (!/\/>$/.test(token)) depth += 1
        }
        if (depth <= 0) break
      }
      if (depth <= 0) blocks.push(<div className="project-readme-html" key={`html-${start}`}>{renderHtml(htmlLines.join('\n'), `html-${start}`)}</div>)
      else blocks.push(<pre key={`html-text-${start}`}>{htmlLines.join('\n')}</pre>)
      continue
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/)
    if (heading) {
      const level = heading[1].length
      const children = renderInline(heading[2], index)
      if (level === 1) blocks.push(<h1 key={`heading-${index}`}>{children}</h1>)
      else if (level === 2) blocks.push(<h2 key={`heading-${index}`}>{children}</h2>)
      else if (level === 3) blocks.push(<h3 key={`heading-${index}`}>{children}</h3>)
      else blocks.push(<h4 key={`heading-${index}`}>{children}</h4>)
      index += 1
      continue
    }
    if (/^(---+|___+|\*\*\*+)\s*$/.test(trimmed)) {
      blocks.push(<hr key={`rule-${index}`} />)
      index += 1
      continue
    }
    const listItem = trimmed.match(/^([-*+]\s+|\d+[.)]\s+)(.*)$/)
    if (listItem) {
      const ordered = /^\d/.test(listItem[1])
      const start = index
      const items: ReactNode[] = []
      while (index < lines.length) {
        const item = lines[index].trim().match(/^([-*+]\s+|\d+[.)]\s+)(.*)$/)
        if (!item || /^\d/.test(item[1]) !== ordered) break
        items.push(<li key={`item-${index}`}>{renderInline(item[2], index)}</li>)
        index += 1
      }
      blocks.push(ordered ? <ol key={`list-${start}`}>{items}</ol> : <ul key={`list-${start}`}>{items}</ul>)
      continue
    }
    if (trimmed.startsWith('>')) {
      const start = index
      const quote: ReactNode[] = []
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quote.push(<p key={`quote-${index}`}>{renderInline(lines[index].trim().replace(/^>\s?/, ''), index)}</p>)
        index += 1
      }
      blocks.push(<blockquote key={`blockquote-${start}`}>{quote}</blockquote>)
      continue
    }
    const start = index
    const paragraph: string[] = []
    while (index < lines.length && lines[index].trim() && !/^(#{1,6}\s|```|~~~|>|([-*+]\s+|\d+[.)]\s+)|---+\s*$|___+\s*$|\*\*\*+\s*$)/.test(lines[index].trim())) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    if (paragraph.length) blocks.push(<p key={`paragraph-${start}`}>{renderInline(paragraph.join(' '), start)}</p>)
    else index += 1
  }
  return <div className="project-readme-body">{blocks}</div>
}
