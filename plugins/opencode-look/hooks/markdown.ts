// Reading a reply's Markdown into blocks and styled spans, so the pane can colour them the OpenCode way.
// Pure: no engine calls, so the tests run it directly. Fences and tables are left whole (`raw`) for the
// engine's own Markdown element, which already draws them well.

export type Span = { text: string; bold?: true; italic?: true; code?: true; strike?: true; link?: string }

export type Block = { gap: boolean } & (
  | { kind: 'heading'; level: number; spans: Span[] }
  | { kind: 'para'; spans: Span[] }
  | { kind: 'item'; marker: string; ordered: boolean; depth: number; spans: Span[] }
  | { kind: 'quote'; spans: Span[] }
  | { kind: 'rule' }
  | { kind: 'raw'; text: string }
)

type Style = Omit<Span, 'text'>

const FENCE = /^\s*(```|~~~)/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

/** The blocks of a Markdown text, in order. `gap` is true when a blank line (or a change of kind) came before. */
export function blocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let gap = false
  let para: string[] = []
  let quote: string[] = []

  const push = (b: Block) => {
    out.push({ ...b, gap: out.length > 0 && b.gap })
    gap = false
  }
  const flush = () => {
    if (para.length) push({ kind: 'para', spans: inline(para.join(' ')), gap })
    if (quote.length) push({ kind: 'quote', spans: inline(quote.join(' ')), gap })
    para = []
    quote = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (!line.trim()) {
      flush()
      gap = true
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      flush()
      const body = [line]
      let j = i + 1
      while (j < lines.length && !(lines[j] ?? '').trim().startsWith(fence[1] ?? '```')) body.push(lines[j++] ?? '')
      if (j < lines.length) body.push(lines[j] ?? '')
      i = j
      push({ kind: 'raw', text: body.join('\n'), gap: true })
      gap = true
      continue
    }
    if (line.includes('|') && TABLE_RULE.test(lines[i + 1] ?? '')) {
      flush()
      const body = [line]
      let j = i + 1
      while (j < lines.length && (lines[j] ?? '').includes('|')) body.push(lines[j++] ?? '')
      i = j - 1
      push({ kind: 'raw', text: body.join('\n'), gap: true })
      gap = true
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      flush()
      push({ kind: 'heading', level: (heading[1] ?? '#').length, spans: inline(heading[2] ?? ''), gap: true })
      continue
    }
    if (RULE.test(line)) {
      flush()
      push({ kind: 'rule', gap: true })
      continue
    }
    const item = ITEM.exec(line)
    if (item) {
      const wasList = out[out.length - 1]?.kind === 'item' && !para.length && !quote.length
      flush()
      const marker = item[2] ?? '-'
      const ordered = /\d/.test(marker)
      push({
        kind: 'item',
        marker: ordered ? marker.replace(')', '.') : marker,
        ordered,
        depth: Math.min(4, Math.floor((item[1] ?? '').replace(/\t/g, '  ').length / 2)),
        spans: inline(item[3] ?? ''),
        gap: gap || !wasList,
      })
      continue
    }
    const q = QUOTE.exec(line)
    if (q) {
      if (para.length) flush()
      quote.push(q[1] ?? '')
      continue
    }
    // a line indented under a list item continues it
    const last = out[out.length - 1]
    if (last?.kind === 'item' && !gap && !para.length && /^\s+\S/.test(line)) {
      last.spans = merge([...last.spans, { text: ' ' }, ...inline(line.trim())])
      continue
    }
    if (quote.length) flush()
    para.push(line.trim())
  }
  flush()
  return out
}

const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c)

/** The styled spans of one line of Markdown: **bold**, *italic*, `code`, ~~strike~~, [links](url). */
export function inline(text: string, style: Style = {}): Span[] {
  const out: Span[] = []
  let buf = ''
  const emit = (t: string, s: Style) => {
    if (!t) return
    const prev = out[out.length - 1]
    if (prev && sameStyle(prev, s)) prev.text += t
    else out.push({ text: t, ...s })
  }
  const flush = () => {
    emit(buf, style)
    buf = ''
  }

  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? ''
    if (c === '\\' && i + 1 < text.length && /[\\`*_~[\]()#>!-]/.test(text[i + 1] ?? '')) {
      buf += text[++i]
      continue
    }
    if (c === '`') {
      const run = /^`+/.exec(text.slice(i))?.[0] ?? '`'
      const end = text.indexOf(run, i + run.length)
      if (end > i) {
        flush()
        emit(text.slice(i + run.length, end).replace(/^ (.*) $/, '$1'), { ...style, code: true })
        i = end + run.length - 1
        continue
      }
    }
    if (c === '[') {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(text.slice(i))
      if (m) {
        flush()
        for (const s of inline(m[1] ?? '', { ...style, link: m[2] ?? '' })) out.push(s)
        i += m[0].length - 1
        continue
      }
    }
    const two = text.slice(i, i + 2)
    if (two === '**' || two === '__' || two === '~~') {
      const end = text.indexOf(two, i + 2)
      const inner = text.slice(i + 2, end)
      if (end > i + 2 && !/^\s|\s$/.test(inner) && (two !== '__' || (!isWord(text[i - 1]) && !isWord(text[end + 2])))) {
        flush()
        for (const s of inline(inner, two === '~~' ? { ...style, strike: true } : { ...style, bold: true })) out.push(s)
        i = end + 1
        continue
      }
    }
    if ((c === '*' || c === '_') && text[i + 1] !== c) {
      let end = i + 1
      while ((end = text.indexOf(c, end)) > 0 && (text[end + 1] === c || text[end - 1] === c)) end += 2
      const inner = end > 0 ? text.slice(i + 1, end) : ''
      const opens = !!inner && !/^\s|\s$/.test(inner)
      const bounded = c === '*' || (!isWord(text[i - 1]) && !isWord(text[end + 1]))
      if (opens && bounded) {
        flush()
        for (const s of inline(inner, { ...style, italic: true })) out.push(s)
        i = end
        continue
      }
    }
    buf += c
  }
  flush()
  return out
}

/** neighbouring spans with the same style, joined */
function merge(list: Span[]): Span[] {
  const out: Span[] = []
  for (const s of list) {
    const prev = out[out.length - 1]
    if (prev && sameStyle(prev, s)) prev.text += s.text
    else out.push({ ...s })
  }
  return out
}

function sameStyle(a: Span, b: Style): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.code === b.code && a.strike === b.strike && a.link === b.link
}

/** "Opus 5.5" from "claude-opus-5-5", "opus", "claude-sonnet-5-5[1m]" */
export function modelName(id: string): string {
  const m = /(opus|sonnet|haiku|fable)(?:-(\d+)(?:-(\d+))?)?/i.exec(id)
  if (!m) return id
  const family = (m[1] ?? '').charAt(0).toUpperCase() + (m[1] ?? '').slice(1).toLowerCase()
  const version = m[2] ? (m[3] ? `${m[2]}.${m[3]}` : m[2]) : ''
  return version ? `${family} ${version}` : family
}

/** "27.5s", "1m 12s", "1h 4m" */
export function seconds(ms: number): string {
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1).replace(/\.0$/, '')}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}
