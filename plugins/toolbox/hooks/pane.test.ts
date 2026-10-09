import { expect, mock, test } from 'claude-code/testing'

const json = (v: unknown) => ({ value: { content: [{ type: 'text' as const, text: JSON.stringify(v) }], isError: false } })

const MY_TIME = {
  toDate: { week: { worked: 34, expected: 40 } },
  thisMonthByDay: { days: [] },
}

const PANE = { plugin: 'toolbox', surface: 'terminal', component: 'Pane', requestId: 'toolbox',
  props: { title: 'Toolbox', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } } as const

test('the pane draws the workday, then the MCP servers', async ($, on) => {
  mock.clock(on, { now: new Date(2026, 9, 9, 13, 35).getTime() })
  mock.env(on, { HOME: '/nowhere' })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('mcp.call', ($, e) => {
    if (e.tool === 'timer_status') return json({ running: true, project: 'Loadbuilder', activity: 'Development', runningForHours: 1.5 })
    if (e.tool === 'my_time') return json(MY_TIME)
    return { value: { content: [{ type: 'text' as const, text: 'unknown tool' }], isError: true } }
  })
  on('tool.list', () => ({ value: [{ name: 'mcp__claude_ai_Google_Calendar__authenticate', description: '', mcp: true }] }))
  on('process.run', () => ({ value: {
    exitCode: 0, stdout: 'pulse: https://pulse.example/mcp (HTTP) - ✔ Connected\n', stderr: '',
    isStdoutTruncated: false, isStderrTruncated: false,
  } }))

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ text: /^Pulse$/ })).toBeDefined()
  expect(await ui.find({ text: /^MCP$/ })).toBeDefined()
  expect(await ui.find({ text: /^Context$/ })).toBeDefined()

  await $.command.run({ command: 'toolbox', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  expect(await ui.find({ text: /Loadbuilder · Development/ })).toBeDefined()
  expect(await ui.find({ text: /1 h 30 min/ })).toBeDefined()
  expect(await ui.find({ text: /Calendar needs login/ })).toBeDefined()
  expect(await ui.find({ text: /week 34\/40 h/ })).toBeDefined()
})

test('waits quietly for a server that is still starting, then shows it', async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 9, 9, 13, 35).getTime() })
  mock.env(on, { HOME: '/nowhere' })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let ready = false
  on('mcp.call', ($, e) => {
    if (!ready) return { deny: `no connected MCP tool "${e.tool}" on a server named "pulse"` }
    if (e.tool === 'timer_status') return json({ running: true, project: 'Loadbuilder', activity: 'Development', runningForHours: 1.5 })
    if (e.tool === 'my_time') return json(MY_TIME)
    return { value: { content: [{ type: 'text' as const, text: 'unknown tool' }], isError: true } }
  })
  on('tool.list', () => ({ value: ready ? [{ name: 'mcp__claude_ai_Google_Calendar__authenticate', description: '', mcp: true }] : [] }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))

  const ui = await $.ui.mount(PANE)
  await $.command.run({ command: 'toolbox', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  expect(await ui.find({ text: /^Pulse: / })).toBeUndefined()
  expect(await ui.find({ text: /^reading…$/ })).toBeDefined()

  ready = true
  await clock.advance(1_000)
  expect(await ui.find({ text: /Loadbuilder · Development/ })).toBeDefined()
  expect(await ui.find({ text: /Calendar needs login/ })).toBeDefined()
})

test('tries every second for the first 20 s, then every 10 s', async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 9, 9, 13, 35).getTime() })
  mock.env(on, { HOME: '/nowhere' })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let ready = false
  let calls = 0
  on('mcp.call', ($, e) => {
    if (e.tool === 'timer_status') calls++
    if (!ready) return { deny: `no connected MCP tool "${e.tool}" on a server named "pulse"` }
    if (e.tool === 'timer_status') return json({ running: true, project: 'Loadbuilder', activity: 'Development', runningForHours: 1.5 })
    if (e.tool === 'my_time') return json(MY_TIME)
    return { value: { content: [{ type: 'text' as const, text: 'unknown tool' }], isError: true } }
  })
  on('tool.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))

  const ui = await $.ui.mount(PANE)
  await $.command.run({ command: 'toolbox', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  await clock.advance(20_000)
  expect(calls).toBe(21)

  ready = true
  await clock.advance(9_000)
  expect(await ui.find({ text: /^reading…$/ })).toBeDefined()
  await clock.advance(1_000)
  expect(await ui.find({ text: /Loadbuilder · Development/ })).toBeDefined()
})

test('checks the MCP servers 15 s after the session starts, not while it connects its own', async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 9, 9, 13, 35).getTime() })
  mock.env(on, { HOME: '/nowhere' })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('mcp.call', ($, e) => (e.tool === 'timer_status' ? json({ running: false }) : json(MY_TIME)))
  on('tool.list', () => ({ value: [] }))
  let lists = 0
  on('process.run', () => {
    lists++
    return { value: {
      exitCode: 0, stdout: 'pulse: https://pulse.example/mcp (HTTP) - ✔ Connected\n', stderr: '',
      isStdoutTruncated: false, isStderrTruncated: false,
    } }
  })

  const ui = await $.ui.mount(PANE)
  await $.session.start({ cwd: '/work/wikidash', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(lists).toBe(0)
  expect(await ui.find({ text: /^checking…$/ })).toBeDefined()

  await clock.advance(15_000)
  expect(lists).toBe(1)
  expect(await ui.find({ text: /^checking…$/ })).toBeUndefined()
})

test('/toolbox close closes the pane', async ($, on) => {
  mock.clock(on, { now: 0 })
  const closed: string[] = []
  on('ui.close', ($, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  const r = await $.command.run({ command: 'toolbox', args: 'close', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  expect(closed).toEqual(['toolbox'])
  expect((r as { text?: string }).text).toContain('closed')
})

test('Context shows tokens, % used and $ spent as the engine measures them', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('session.measure', () => ({ changed: [] }))
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ text: /^after the first reply$/ })).toBeDefined()
  await $.session.measure({ context: { tokens: 64115, window: 1_000_000, percent: 6 }, rateLimits: [], cost: { usd: 0.3214 }, changed: [] })
  expect(await ui.find({ text: /^64,115 tokens$/ })).toBeDefined()
  expect(await ui.find({ text: /^6% used$/ })).toBeDefined()
  expect(await ui.find({ text: /^\$0\.32 spent$/ })).toBeDefined()
})
