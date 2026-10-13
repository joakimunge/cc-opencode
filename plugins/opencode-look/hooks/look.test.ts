import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { blocks, inline, modelName, seconds } from './markdown'

test('inline marks: bold, italic, code, strike, links', () => {
  expect(inline('Run **`npm test`** now')).toEqual([
    { text: 'Run ' }, { text: 'npm test', bold: true, code: true }, { text: ' now' },
  ])
  expect(inline('a *soft* and _quiet_ word')).toEqual([
    { text: 'a ' }, { text: 'soft', italic: true }, { text: ' and ' }, { text: 'quiet', italic: true }, { text: ' word' },
  ])
  expect(inline('~~old~~ [docs](https://x.dev)')).toEqual([
    { text: 'old', strike: true }, { text: ' ' }, { text: 'docs', link: 'https://x.dev' },
  ])
})

test('leaves snake_case, lone stars and escapes alone', () => {
  expect(inline('use read_db and write_db')).toEqual([{ text: 'use read_db and write_db' }])
  expect(inline('2 * 3 = 6')).toEqual([{ text: '2 * 3 = 6' }])
  expect(inline('a \\*literal\\* star')).toEqual([{ text: 'a *literal* star' }])
})

test('nested: italic inside bold', () => {
  expect(inline('**very *much* so**')).toEqual([
    { text: 'very ', bold: true }, { text: 'much', bold: true, italic: true }, { text: ' so', bold: true },
  ])
})

test('blocks: heading, paragraph, list, fence, table, quote', () => {
  const md = [
    '## Plan', '', 'First line', 'same paragraph.', '', '1. one', '2. two', '   - nested', '',
    '```ts', 'const x = 1', '```', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', '> careful',
  ].join('\n')
  const list = blocks(md)
  expect(list.map((b) => b.kind)).toEqual(['heading', 'para', 'item', 'item', 'item', 'raw', 'raw', 'quote'])
  expect(list.map((b) => b.gap)).toEqual([false, true, true, false, false, true, true, true])
  expect(list[1]).toMatchObject({ spans: [{ text: 'First line same paragraph.' }] })
  expect(list[4]).toMatchObject({ kind: 'item', depth: 1, ordered: false })
  expect(list[5]).toMatchObject({ text: '```ts\nconst x = 1\n```' })
  expect(list[6]).toMatchObject({ text: '| a | b |\n|---|---|\n| 1 | 2 |' })
})

test('a wrapped list item keeps its continuation line', () => {
  expect(blocks('- first part\n  and the rest')[0]).toMatchObject({ spans: [{ text: 'first part and the rest' }] })
})

test('model names and times', () => {
  expect([modelName('claude-opus-5-5'), modelName('opus'), modelName('claude-sonnet-5-5[1m]')]).toEqual(['Opus 5.5', 'Opus', 'Sonnet 5.5'])
  expect([seconds(27_500), seconds(3_000), seconds(72_000), seconds(3_840_000)]).toEqual(['27.5s', '3s', '1m 12s', '1h 4m'])
})

const config = (on: On) =>
  on('config.list', () => ({
    value: [
      { key: 'model', label: 'Model', kind: 'choice', value: 'claude-opus-5-5', owner: 'engine' },
      { key: 'effortLevel', label: 'Effort', kind: 'choice', value: 'xhigh', owner: 'engine' },
    ] as never,
  }))

test('a reply draws bold orange, code green, numbers cyan', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const ui = await $.ui.mount({
    plugin: 'opencode-look', surface: 'terminal', component: 'AssistantMessage',
    props: { text: '**Next:** run `npm test`, *gently*\n\n1. first', isFirstOfReply: true },
  })
  expect(await ui.find({ type: 'Text', text: /^gently$/ })).toMatchObject({ props: { italic: true, color: 'warning' } })
  expect(await ui.find({ type: 'Text', text: /^Next:$/ })).toMatchObject({ props: { bold: true, color: 'bashBorder' } })
  expect(await ui.find({ type: 'Text', text: /^npm test$/ })).toMatchObject({ props: { color: 'success' } })
  expect(await ui.find({ type: 'Text', text: /^1\. $/ })).toMatchObject({ props: { color: 'suggestion' } })
})

test('your message gets the dark block and pink bar, inside the gutter', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const ui = await $.ui.mount({
    plugin: 'opencode-look', surface: 'terminal', component: 'UserMessage',
    props: { text: 'test', origin: { kind: 'composer' }, isExpanded: false },
  })
  expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { paddingLeft: 3, paddingRight: 3, paddingY: 1 } })
  expect(((await ui.drawn()) as { props?: Record<string, unknown> }).props?.backgroundColor).toBeUndefined()
  expect(await ui.find({ key: 'block' })).toMatchObject({
    props: { backgroundColor: 'userMessageBackground', paddingLeft: 3, paddingRight: 2, paddingY: 1 },
  })
  expect(await ui.find({ type: 'Text', text: /^test$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^▍\n▍/ })).toBeDefined()
})

test('the turn ends with ▣ word · model · time, the prompt hint with model and effort', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  config(on)
  const done = await $.ui.mount({
    plugin: 'opencode-look', surface: 'terminal', component: 'TurnDuration', props: { word: 'Cooked', durationMs: 27_500 },
  })
  expect(await done.find({ type: 'Text', text: /^ · Opus 5\.5 · 27\.5s$/ })).toBeDefined()
  const hint = await $.ui.mount({
    plugin: 'opencode-look', surface: 'terminal', component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  })
  expect(await hint.find({ type: 'Text', text: /^xhigh$/ })).toMatchObject({ props: { bold: true } })
})

test("the engine's own rows are moved in to line up with replies", async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('ui.render', { component: 'Spinner' }, () => ({ type: 'Text', props: {}, children: ['Thinking…'] }) as never)
  const ui = await $.ui.mount({
    plugin: 'opencode-look', surface: 'terminal', component: 'Spinner',
    props: { word: 'Thinking', message: null, suffix: '', mode: 'thinking' },
  })
  expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { paddingLeft: 4, paddingRight: 3 } })
  expect(await ui.find({ type: 'Text', text: /^Thinking…$/ })).toBeDefined()
})

test("the engine's short summaries get the same colours", async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const ui = await $.ui.mount({
    plugin: 'opencode-look', surface: 'terminal', component: 'AssistantMessage',
    props: { text: 'Found it: **colour depth**', isFirstOfReply: true, isSummary: true },
  })
  expect(await ui.find({ type: 'Text', text: /^colour depth$/ })).toMatchObject({ props: { bold: true, color: 'bashBorder' } })
})
