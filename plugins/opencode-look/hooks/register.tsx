// OpenCode look: Claude Code laid out the way OpenCode lays itself out, in the colours of whatever theme you use.
//  - colours are roles read from your theme (/theme), never fixed values, so the look fits any theme; a theme that
//    sets these keys to OpenCode's Synthwave '84 colours (opencode.json) gives OpenCode's look exactly
//  - your messages: a block in the theme's message background, inside the gutter, with an accent bar along its left
//    edge and room around the text
//  - replies (and the engine's short summaries of them): Markdown in colour — **bold**, *italics*, `code`,
//    list numbers and headings each in their role's colour; code blocks and tables are left to the engine's Markdown
//  - the end of a turn: "▣  Done · Opus 5.5 · 27.5s"
//  - under the prompt: "Claude · Opus 5.5 · xhigh", then the engine's hint
//  - padding: a gutter of GUTTER columns on both sides; your text, replies and the footer line up at TEXT;
//    tool calls, command output, notices and the spinner are inset to match
import type { EngineInterface, Register, RenderElement, RenderInput } from 'claude-code'
import { blocks, modelName, seconds } from './markdown'
import type { Block, Span } from './markdown'

// colour roles, each a key of the theme (what OpenCode's Synthwave '84 sets it to, in opencode.json)
/** the bar beside your messages, ▣, headings, bullets (pink) */
const ACCENT = 'claude'
/** **bold** (orange) */
const STRONG = 'bashBorder'
/** *italics* (yellow) */
const EMPHASIS = 'warning'
/** `code` (green) */
const CODE = 'success'
/** list numbers, links, third-level headings (cyan) */
const MARKER = 'suggestion'
/** quiet text (lavender) */
const MUTED = 'inactive'
/** the block behind your messages (dark violet) */
const BLOCK = 'userMessageBackground'
/** the bar beside your messages: a left three-eighths block, so it sits flush with the block's left edge */
const BAR = '▍'
const BAR_ROWS = 400
/** where a message came from when you typed it (or sent it from another device) */
const TYPED = new Set(['composer', 'bridge', 'unclassified'])
/** columns of empty space at the left and right edge */
const GUTTER = 3
/** columns between the bar and your text, and after your text */
const ROOM = 2
/** where text starts: the gutter, the bar, then room after it */
const TEXT = GUTTER + 1 + ROOM

type Elements = ReturnType<EngineInterface['ui']['resolve']>

let label = { model: '', effort: '', at: -Infinity }

/** the model and effort as /config shows them, read at most every 30 s */
async function modelLabel($: EngineInterface) {
  const now = await $.clock.now()
  if (now - label.at < 30_000) return label
  try {
    const rows = await $.config.list()
    const value = (re: RegExp) => {
      const row = rows.find((r) => re.test(r.key) || re.test(r.label))
      return row && (typeof row.value === 'string' || typeof row.value === 'number') ? String(row.value) : ''
    }
    label = { model: modelName(value(/^model$/i)), effort: value(/effort/i), at: now }
  } catch {
    label = { ...label, at: now }
  }
  return label
}

/** one span as a Text */
function span({ Text }: Elements, s: Span, key: string) {
  const color = s.code ? CODE : s.link ? MARKER : s.bold ? STRONG : s.italic ? EMPHASIS : undefined
  return (
    <Text key={key} color={color} bold={s.bold} italic={s.italic} strikethrough={s.strike} underline={!!s.link}>
      {s.text}
      {s.link && s.link !== s.text ? <Text color={MUTED} underline={false}> ({s.link})</Text> : null}
    </Text>
  )
}

function spans(ui: Elements, list: Span[], prefix: string) {
  return list.map((s, i) => span(ui, s, `${prefix}-${i}`))
}

/** one block of a reply */
function block(ui: Elements, b: Block, i: number) {
  const { Box, Text, Markdown } = ui
  const key = `b${i}`
  const top = b.gap ? 1 : 0
  switch (b.kind) {
    case 'heading':
      return (
        <Box key={key} marginTop={top}>
          <Text bold color={b.level <= 2 ? ACCENT : b.level === 3 ? MARKER : undefined} wrap="wrap">{spans(ui, b.spans, key)}</Text>
        </Box>
      )
    case 'item':
      return (
        <Box key={key} marginTop={top} marginLeft={b.depth * 2} flexDirection="row">
          <Text color={b.ordered ? MARKER : ACCENT}>{b.ordered ? b.marker : b.depth ? '◦' : '•'} </Text>
          <Box flexShrink={1}>
            <Text wrap="wrap">{spans(ui, b.spans, key)}</Text>
          </Box>
        </Box>
      )
    case 'quote':
      return (
        <Box key={key} marginTop={top} flexDirection="row">
          <Text color={MUTED}>┃ </Text>
          <Box flexShrink={1}>
            <Text italic color={MUTED} wrap="wrap">{spans(ui, b.spans, key)}</Text>
          </Box>
        </Box>
      )
    case 'rule':
      return <Box key={key} marginTop={top}><Text color={MUTED}>{'─'.repeat(40)}</Text></Box>
    case 'raw':
      return <Box key={key} marginTop={top}><Markdown text={b.text} /></Box>
    case 'para':
      return (
        <Box key={key} marginTop={top}>
          <Text wrap="wrap">{spans(ui, b.spans, key)}</Text>
        </Box>
      )
  }
}

/** an engine-drawn row, moved in by the gutter and the bar's width */
async function inset($: EngineInterface, e: RenderInput, tree: RenderElement): Promise<RenderElement> {
  if (e.surface !== 'terminal' || !tree) return tree
  const { Box } = $.ui.resolve(e)
  return <Box flexDirection="column" paddingLeft={TEXT - 2} paddingRight={GUTTER}>{tree}</Box>
}

export const register: Register = (on) => {
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const p = e.props
    if (e.surface !== 'terminal' || !TYPED.has(p.origin.kind) || p.task || p.from) return next(e)
    if (!p.isExpanded && p.text.split('\n').length > 40) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      // the block is painted here: the engine no longer paints the message background behind a hook's tree;
      // a row of space above and below sets it apart from what comes before and after
      <Box flexDirection="column" paddingLeft={GUTTER} paddingRight={GUTTER} paddingY={1}>
        <Box key="block" flexDirection="column" position="relative" backgroundColor={BLOCK} paddingLeft={TEXT - GUTTER} paddingRight={ROOM} paddingY={1}>
          <Box position="absolute" top={0} left={0} bottom={0} width={1} overflow="hidden" flexDirection="column">
            <Text color={ACCENT}>{Array.from({ length: BAR_ROWS }, () => BAR).join('\n')}</Text>
          </Box>
          <Text wrap="wrap">{p.text}</Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const ui = $.ui.resolve(e)
    const { Box } = ui
    return (
      <Box flexDirection="column" paddingLeft={TEXT} paddingRight={GUTTER}>
        {blocks(e.props.text).map((b, i) => block(ui, b, i))}
      </Box>
    )
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const { model } = await modelLabel($)
    return (
      <Box paddingLeft={TEXT} paddingRight={GUTTER} marginTop={1}>
        <Text>
          <Text color={ACCENT}>▣  </Text>
          <Text>{e.props.word || 'Done'}</Text>
          <Text color={MUTED}>{model ? ` · ${model}` : ''} · {seconds(e.props.durationMs)}</Text>
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const { model, effort } = await modelLabel($)
    const { hint, tail } = e.props
    return (
      <Box paddingLeft={GUTTER} paddingRight={GUTTER}>
        <Text wrap="truncate-end">
          <Text color={ACCENT}>Claude</Text>
          {model ? <Text color={MUTED}> · </Text> : null}
          {model ? <Text>{model}</Text> : null}
          {effort ? <Text color={MUTED}> · </Text> : null}
          {effort ? <Text color={EMPHASIS} bold>{effort}</Text> : null}
          {hint ? <Text color={MUTED}>{'   '}{hint}</Text> : null}
          {tail ? <Text color={MUTED}> {tail}</Text> : null}
        </Text>
      </Box>
    )
  })

  // the engine's own rows, inset so their text starts where replies do (the row's own bullet sits in front)
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => inset($, e, await next(e)))
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => inset($, e, await next(e)))
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => inset($, e, await next(e)))
  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => inset($, e, await next(e)))
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => inset($, e, await next(e)))
  on('ui.render', { component: 'InfoNotice' }, async ($, e, next) => inset($, e, await next(e)))
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => inset($, e, await next(e)))
}
