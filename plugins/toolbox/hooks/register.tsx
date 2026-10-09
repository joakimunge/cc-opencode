// Toolbox: one side pane laid out like OpenCode's sidebar: the folder as a title, the context window (tokens, % used,
// $ spent), your workday, your MCP servers (and whether each is connected), your skills, and the folder and
// Claude Code's version pinned to the bottom.
//  - Context: read when the session starts, then each time the engine measures usage again (session.measure)
//  - Workday: your Pulse timer (every minute) and today's hours (every 5 minutes); Stop (s) asks, then logs the time.
//    Your next appointment from claude.ai Google Calendar (the next 7 days, every 5 minutes); until that connector
//    is logged in (/mcp) the pane says so, and picks it up on the next check. Countdowns tick every 30 s
//  - MCP status comes from `claude mcp list`: checked 15 s after the session starts (once the session's own
//    connections are done), every 2 minutes, and on Refresh (r)
//  - skills are read from their folders: yours (~/.claude/skills), claude.ai's synced ones, the project's
//    (.claude/skills) and every installed plugin's (skills/ and commands/)
//  - Refresh (r) reads everything now; /toolbox opens the pane again after you close it; /toolbox refresh checks now;
//    /toolbox close closes it
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { CalEvent, CalState, Hours, McpServer, McpStatus, PulseTimer, Skill, SkillGroup, Usage } from '../types'
import { ago, parseMcpList, parseSkill, sortServers } from './data'
import {
  commas, countdown, duration, hours, localDate, money, parseEvents, parseHours, parseTimer, payload, pickListTool, splitPath,
  textOf, upcoming, when,
} from './workday-data'

const PANE = 'toolbox'
const WIDTH = 44
/** the narrowest terminal Claude Code docks a pane beside the transcript in; below it the pane would stack above the prompt */
const DOCK_COLUMNS = 110
const EVERY_MS = 2 * 60 * 1000
/** how long after the session starts the first MCP check waits */
const MCP_DELAY_MS = 15_000

const servers = atom({ plugin: 'toolbox', key: 'servers' } as const, [] as McpServer[])
const mcpError = atom({ plugin: 'toolbox', key: 'mcpError' } as const, '')
const checkedAt = atom({ plugin: 'toolbox', key: 'checkedAt' } as const, 0)
const checking = atom({ plugin: 'toolbox', key: 'checking' } as const, false)
const skills = atom({ plugin: 'toolbox', key: 'skills' } as const, [] as SkillGroup[])
const usage = atom({ plugin: 'toolbox', key: 'usage' } as const, null as Usage | null)
const folder = atom({ plugin: 'toolbox', key: 'cwd' } as const, '')
const version = atom({ plugin: 'toolbox', key: 'version' } as const, '')

const COLOR: Record<McpStatus, 'success' | 'warning' | 'error' | 'inactive'> = {
  connected: 'success', auth: 'warning', failed: 'error', pending: 'inactive',
}
const LABEL: Record<McpStatus, string> = { connected: 'connected', auth: 'needs login', failed: 'failed', pending: 'checking' }

let cwd = ''
let home = ''
let busy = false

async function refreshMcp($: EngineInterface) {
  if (busy) return
  busy = true
  await update($, checking, () => true)
  try {
    const run = await $.process.run(['claude', 'mcp', 'list'], { timeoutMs: 120_000 })
    const list = sortServers(parseMcpList(run.stdout))
    const why = list.length || run.exitCode === 0 ? '' : run.stderr.trim().split('\n').pop() || `claude mcp list exited with ${run.exitCode}`
    await update($, servers, () => list)
    await update($, mcpError, () => why)
  } catch (err) {
    await update($, mcpError, () => `couldn't run claude mcp list (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    const now = await $.clock.now()
    await update($, checkedAt, () => now)
    await update($, checking, () => false)
    busy = false
  }
}

async function dirs($: EngineInterface, path: string): Promise<string[]> {
  try {
    const entries = await $.fs.list(path)
    return entries.filter((x) => x.kind === 'dir' && !x.name.startsWith('.')).map((x) => x.name).sort()
  } catch {
    return []
  }
}

async function files($: EngineInterface, path: string, suffix: string): Promise<string[]> {
  try {
    const entries = await $.fs.list(path)
    return entries.filter((x) => x.kind === 'file' && x.name.endsWith(suffix)).map((x) => x.name).sort()
  } catch {
    return []
  }
}

async function skill($: EngineInterface, file: string, name: string): Promise<Skill | null> {
  try {
    return parseSkill(await $.fs.read(file), name)
  } catch {
    return null
  }
}

/** every SKILL.md one level under `root` */
async function skillsIn($: EngineInterface, root: string, skip: string[] = []): Promise<Skill[]> {
  const found = await Promise.all(
    (await dirs($, root)).filter((d) => !skip.includes(d)).map((d) => skill($, `${root}/${d}/SKILL.md`, d)),
  )
  return found.filter((x): x is Skill => x !== null)
}

async function refreshSkills($: EngineInterface) {
  const home = (await $.env.get('HOME')) ?? ''
  const groups: SkillGroup[] = []
  const add = (label: string, list: Skill[]) => {
    if (list.length) groups.push({ label, skills: [...list].sort((a, b) => a.name.localeCompare(b.name)) })
  }
  if (home) {
    add('Yours', await skillsIn($, `${home}/.claude/skills`, ['synced']))
    const synced: Skill[] = []
    for (const bucket of await dirs($, `${home}/.claude/skills/synced`)) synced.push(...(await skillsIn($, `${home}/.claude/skills/synced/${bucket}`)))
    add('claude.ai', synced)
  }
  if (cwd) add('This project', await skillsIn($, `${cwd}/.claude/skills`))
  if (home) {
    try {
      const installed = JSON.parse(await $.fs.read(`${home}/.claude/plugins/installed_plugins.json`)) as {
        plugins?: Record<string, { installPath?: string }[]>
      }
      for (const [id, installs] of Object.entries(installed.plugins ?? {})) {
        const path = installs[0]?.installPath
        if (!path) continue
        const list = await skillsIn($, `${path}/skills`)
        for (const f of await files($, `${path}/commands`, '.md')) {
          const s = await skill($, `${path}/commands/${f}`, f.replace(/\.md$/, ''))
          if (s) list.push(s)
        }
        add(`Plugin · ${id.split('@')[0]}`, list)
      }
    } catch {
      // no plugins installed
    }
  }
  await update($, skills, () => groups)
}

// --- Workday ---

type Elements = ReturnType<EngineInterface['ui']['resolve']>

const PULSE = 'pulse'
const CALENDAR = 'claude.ai Google Calendar'
const CAL_PREFIX = 'mcp__claude_ai_Google_Calendar__'
const MIN = 60_000

const timer = atom({ plugin: 'toolbox', key: 'timer' } as const, null as PulseTimer | null)
const logged = atom({ plugin: 'toolbox', key: 'hours' } as const, null as Hours | null)
const pulseError = atom({ plugin: 'toolbox', key: 'pulseError' } as const, '')
const events = atom({ plugin: 'toolbox', key: 'events' } as const, [] as CalEvent[])
const calState = atom({ plugin: 'toolbox', key: 'calState' } as const, 'checking' as CalState)
const calError = atom({ plugin: 'toolbox', key: 'calError' } as const, '')
const clockNow = atom({ plugin: 'toolbox', key: 'now' } as const, 0)

const LOGIN = /auth|log ?in|sign ?in|not connected|unauthori[sz]ed/i
const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
const running = new Set<string>()
/** what a call says while its server is still connecting, just after Claude Code starts */
const STARTING = /no connected MCP tool|no server named|connecting|pending/i
const tries = new Map<string, number>()
/** jobs with a retry already on its way */
const waiting = new Set<string>()
/** servers are usually up 2–5 s after Claude Code starts: try every second for the first 20 s, then every 10 s */
const FAST_TRIES = 20
const MAX_TRIES = FAST_TRIES + 10

/** read `job` again soon while its server is still starting, for 2 minutes in all; false once given up */
function retry($: EngineInterface, job: 'timer' | 'hours' | 'calendar'): boolean {
  const n = tries.get(job) ?? 0
  if (n >= MAX_TRIES) return false
  if (waiting.has(job)) return true
  tries.set(job, n + 1)
  waiting.add(job)
  void $.clock
    .sleep(n < FAST_TRIES ? 1_000 : 10_000)
    .then(() => {
      waiting.delete(job)
      return job === 'timer' ? readTimer($) : job === 'hours' ? readHours($) : readCalendar($)
    })
    .catch(() => waiting.delete(job)) // the mod reloaded or the session ended while it waited
  return true
}

/** run `fn` unless the same job is still running */
async function once(job: string, fn: () => Promise<void>) {
  if (running.has(job)) return
  running.add(job)
  try {
    await fn()
  } finally {
    running.delete(job)
  }
}

const tick = async ($: EngineInterface) => {
  const now = await $.clock.now()
  await update($, clockNow, () => now)
}

const readTimer = ($: EngineInterface) =>
  once('timer', async () => {
    try {
      const r = await $.mcp.call(PULSE, 'timer_status')
      if (r.isError) throw new Error(textOf(r) || 'timer_status failed')
      const t = parseTimer(payload(r), await $.clock.now())
      tries.delete('timer')
      await update($, timer, () => t)
      await update($, pulseError, () => '')
    } catch (err) {
      const why = message(err)
      const waiting = STARTING.test(why) && retry($, 'timer')
      await update($, pulseError, () => (waiting ? '' : `Pulse: ${why}`))
    }
    await tick($)
  })

const readHours = ($: EngineInterface) =>
  once('hours', async () => {
    try {
      const r = await $.mcp.call(PULSE, 'my_time')
      if (r.isError) throw new Error(textOf(r) || 'my_time failed')
      const today = parseHours(payload(r), localDate(await $.clock.now()))
      tries.delete('hours')
      await update($, logged, () => today)
    } catch (err) {
      const why = message(err)
      if (!(STARTING.test(why) && retry($, 'hours'))) await update($, pulseError, () => `Pulse: ${why}`)
    }
  })

/** list_events' arguments: it reads from now to 7 days ahead by itself; the bare call is the fallback */
function calendarArgs(): Record<string, unknown>[] {
  return [{ orderBy: 'startTime', pageSize: 20 }, {}]
}

const readCalendar = ($: EngineInterface) =>
  once('calendar', async () => {
    const names = (await $.tool.list()).map((t) => t.name)
    const found = pickListTool(names, CAL_PREFIX)
    // no Calendar tools at all yet: the connector is still starting
    if (!names.some((n) => n.startsWith(CAL_PREFIX)) && retry($, 'calendar')) return
    if (!found && names.includes(`${CAL_PREFIX}authenticate`)) {
      tries.delete('calendar')
      await update($, calState, () => 'login')
      await update($, events, () => [])
      return
    }
    const tools = [...new Set([found, 'list_events', 'list_gcal_events', 'search_events'].filter((t): t is string => !!t))]
    const now = await $.clock.now()
    let last = ''
    for (const tool of tools) {
      for (const args of calendarArgs()) {
        try {
          const r = await $.mcp.call(CALENDAR, tool, args)
          if (r.isError) {
            last = textOf(r)
            if (LOGIN.test(last)) break
            continue
          }
          await update($, events, () => upcoming(parseEvents(payload(r)), now))
          tries.delete('calendar')
          await update($, calState, () => 'ok')
          await update($, calError, () => '')
          return
        } catch (err) {
          last = message(err)
          if (LOGIN.test(last)) break
        }
      }
      if (LOGIN.test(last)) break
    }
    if (STARTING.test(last) && !LOGIN.test(last) && retry($, 'calendar')) return
    await update($, calState, () => (LOGIN.test(last) ? 'login' : 'error'))
    await update($, calError, () => last.slice(0, 160))
  })

/** read Pulse and the calendar now */
const readWorkday = ($: EngineInterface) => Promise.all([readTimer($), readHours($), readCalendar($)])

/** read now, then keep reading: call once per session start */
function startWorkday($: EngineInterface) {
  void readWorkday($)
  $.clock.every(30_000, () => void tick($))
  $.clock.every(MIN, () => void readTimer($))
  $.clock.every(5 * MIN, () => void Promise.all([readHours($), readCalendar($)]))
}

async function stopTimer($: EngineInterface) {
  const t = await read($, timer)
  if (!t?.running) return
  const now = await $.clock.now()
  const what = [t.project, t.activity].filter(Boolean).join(' · ') || 'the timer'
  const STOP = 'Stop and log it'
  const answer = await $.ui.ask(`Stop ${what} and log ${duration(now - t.since)}?`, {
    header: 'Pulse',
    options: [STOP, 'Keep it running'],
  })
  if (answer !== STOP) return
  try {
    const r = await $.mcp.call(PULSE, 'stop_timer')
    $.ui.toast(r.isError ? `Pulse didn't stop the timer: ${textOf(r).slice(0, 120)}` : `Logged ${duration(now - t.since)} on ${what}.`)
  } catch (err) {
    $.ui.toast(`Pulse didn't stop the timer: ${message(err)}`)
  }
  await Promise.all([readTimer($), readHours($)])
}

/** the Workday section's tree, at the top of the pane */
async function workdaySection($: EngineInterface, { Box, Text, Button }: Elements) {
  const t = await read($, timer)
  const hrs = await read($, logged)
  const pErr = await read($, pulseError)
  const list = await read($, events)
  const cal = await read($, calState)
  const cErr = await read($, calError)
  const now = (await read($, clockNow)) || (await $.clock.now())
  const next = upcoming(list, now)
  const first = next[0]
  const then = next[1]
  const what = t ? [t.project, t.activity].filter(Boolean).join(' · ') : ''
  const nothingToday = !!hrs && hrs.today === 0 && hrs.todayExpected > 0 && !t?.running

  return (
    <Box flexDirection="column">
      <Text bold>Pulse</Text>
      {t === null && !pErr ? <Text color="inactive">reading…</Text> : null}
      {t?.running ? (
        <Box flexDirection="column">
          <Text wrap="truncate-end"><Text color="success">●</Text> {what}</Text>
          <Box flexDirection="row" gap={1}>
            <Text color={t.forgotten ? 'warning' : undefined}>  {duration(now - t.since)}{t.forgotten ? ' · looks forgotten' : ''}</Text>
            <Button key="stop" hotkey="s" plain onPress={() => void stopTimer($)}>Stop</Button>
          </Box>
        </Box>
      ) : t ? (
        <Text color="inactive">○ No timer running</Text>
      ) : null}
      {hrs ? (
        <Text>
          <Text color={nothingToday ? 'warning' : undefined}>Today {hours(hrs.today)}/{hours(hrs.todayExpected)} h</Text>
          <Text color="inactive"> · week {hours(hrs.week)}/{hours(hrs.weekExpected)} h</Text>
        </Text>
      ) : null}
      {pErr ? <Text wrap="wrap"><Text color="error">● </Text><Text color="inverseText" backgroundColor="inactive">{pErr}</Text></Text> : null}

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Next up</Text>
        {cal === 'checking' ? <Text color="inactive">reading…</Text> : null}
        {cal === 'login' ? <Text><Text color="warning">○</Text> Calendar <Text color="inactive">needs login · /mcp</Text></Text> : null}
        {cal === 'error' ? <Text wrap="wrap"><Text color="error">● </Text>Calendar <Text color="inverseText" backgroundColor="inactive">{cErr || 'couldn\'t read events'}</Text></Text> : null}
        {cal === 'ok' && !first ? <Text color="inactive">Nothing in the next 7 days</Text> : null}
        {first ? (
          <Box flexDirection="column">
            <Text wrap="truncate-end"><Text bold>{when(first.start, now)}</Text> {first.title}</Text>
            <Text color={first.start - now < 10 * MIN ? 'warning' : 'inactive'}>
              {'  '}{countdown(first, now)}{first.start > now ? ` · ${duration(first.end - first.start)}` : ''}
            </Text>
            {first.where ? <Text color="inactive" wrap="truncate-end">  {first.where}</Text> : null}
          </Box>
        ) : null}
        {then ? <Text color="inactive" wrap="truncate-end">then {when(then.start, now)} {then.title}</Text> : null}
      </Box>
    </Box>
  )
}

// --- the pane ---

async function readUsage($: EngineInterface) {
  try {
    const u = await $.session.usage()
    const { tokens, percent } = u.context
    if (tokens !== undefined) await update($, usage, () => ({ tokens, percent: percent ?? 0, usd: u.cost?.usd ?? 0 }))
  } catch {
    // before the first response there is nothing to show
  }
}

const refreshAll = ($: EngineInterface) => Promise.all([refreshMcp($), refreshSkills($), readWorkday($)])

const open = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Toolbox', columns: WIDTH })

let hiding = false

/** take the pane off a terminal too narrow to dock it: closed, then opened again by the plugin (not the person), so it
 *  waits undrawn and docks again by itself once the terminal is wide enough */
async function hide($: EngineInterface) {
  if (hiding) return
  hiding = true
  try {
    await $.ui.close({ id: PANE })
    await open($)
  } catch {
    // the session ended or the module reloaded
  } finally {
    hiding = false
  }
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    home = (await $.env.get('HOME')) ?? ''
    await update($, folder, () => e.cwd)
    void readUsage($)
    void $.session.version().then((v) => update($, version, () => v.base ?? v.version)).catch(() => {})
    await $.command.register({ name: 'toolbox', description: 'Show your workday, MCP servers and installed skills in a side pane (refresh: check now · close: close it)' })
    void open($)
    // `claude mcp list` connects to every server again: wait until the session's own connections are done
    await update($, checking, () => true)
    void $.clock.sleep(MCP_DELAY_MS).then(() => refreshMcp($)).catch(() => {})
    void refreshSkills($)
    startWorkday($)
    $.clock.every(EVERY_MS, () => void refreshMcp($))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const { tokens, percent } = e.context
    if (tokens !== undefined) await update($, usage, () => ({ tokens, percent: percent ?? 0, usd: e.cost?.usd ?? 0 }))
    return next(e)
  })

  on('command.run', { command: 'toolbox' }, async ($, e) => {
    if (e.args.trim() === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'Toolbox pane closed. /toolbox opens it again.' }
    }
    const opened = await open($)
    if (e.args.trim() === 'refresh') {
      void refreshAll($)
      return { text: 'Toolbox: checking your MCP servers and skills.' }
    }
    if (e.presentation.isFullscreen && e.presentation.columns < DOCK_COLUMNS) {
      return { text: `Toolbox: widen the terminal to ${DOCK_COLUMNS} columns to see the pane.` }
    }
    return { text: opened.isPlaced ? 'Toolbox pane opened.' : 'Toolbox: widen the terminal to see the pane.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // in fullscreen, inline means the terminal got too narrow to dock the pane: hide it rather than stack it
    if (e.surface === 'terminal' && e.props.placement === 'inline' && e.viewport?.isFullscreen && e.viewport.columns < DOCK_COLUMNS) {
      void hide($)
      const { Box } = $.ui.resolve(e)
      return <Box />
    }
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const workday = await workdaySection($, elements)
    const list = await read($, servers)
    const error = await read($, mcpError)
    const at = await read($, checkedAt)
    const isChecking = await read($, checking)
    const groups = await read($, skills)
    const ctx = await read($, usage)
    const where = splitPath((await read($, folder)) || cwd, home)
    const ver = await read($, version)
    const now = await $.clock.now()
    const shown = list.filter((s) => s.status === 'connected' || s.status === 'failed')
    const login = list.filter((s) => s.status === 'auth' || s.status === 'pending')
    const total = groups.reduce((n, g) => n + g.skills.length, 0)

    return (
      <Box flexDirection="column" paddingX={2} paddingY={1} minHeight={e.props.scroll.bodyRows}>
        <Text bold wrap="truncate-end">{where.name || 'Claude Code'}</Text>

        <Box flexDirection="column" marginTop={1}>
          <Text bold>Context</Text>
          {ctx ? (
            <Box flexDirection="column">
              <Text color="inactive">{commas(ctx.tokens)} tokens</Text>
              <Text color={ctx.percent >= 80 ? 'warning' : 'inactive'}>{ctx.percent}% used</Text>
              <Text color="inactive">{money(ctx.usd)} spent</Text>
            </Box>
          ) : (
            <Text color="inactive">after the first reply</Text>
          )}
        </Box>

        <Box flexDirection="column" marginTop={1}>{workday}</Box>

        <Box flexDirection="column" marginTop={1}>
          <Text bold>MCP</Text>
          {!list.length ? <Text color="inactive">{isChecking ? 'checking…' : 'none found'}</Text> : null}
          {error ? <Text wrap="wrap"><Text color="error">● </Text><Text color="inverseText" backgroundColor="inactive">{error}</Text></Text> : null}
          {shown.map((s) => (
            <Text key={`${s.source}/${s.name}`} wrap="wrap">
              <Text color={COLOR[s.status]}>• </Text>{s.name}
              {s.source !== 'claude.ai' ? <Text color="inactive"> · {s.source}</Text> : null}
              {s.status === 'connected'
                ? <Text color="inactive"> Connected</Text>
                : <Text> <Text color="inverseText" backgroundColor="inactive">{s.detail || LABEL[s.status]}</Text></Text>}
            </Text>
          ))}
          {login.length ? (
            <Text wrap="wrap">
              <Text color="warning">• </Text>
              <Text color="inactive">{login.length} need login: {login.map((s) => s.name).join(', ')}</Text>
            </Text>
          ) : null}
        </Box>

        <Box flexDirection="column" marginTop={1}>
          <Text bold>Skills <Text color="inactive">{total}</Text></Text>
          {groups.length === 0 ? <Text color="inactive">none found</Text> : null}
          {groups.map((g) => (
            <Text key={g.label} wrap="wrap">
              {g.label.replace(/^Plugin · /, '')} <Text color="inactive">{g.skills.map((s) => s.name).join(' · ')}</Text>
            </Text>
          ))}
        </Box>

        <Box flexDirection="row" marginTop={1} gap={1}>
          <Button key="refresh" hotkey="r" plain onPress={() => void refreshAll($)}>Refresh</Button>
          <Text color="inactive">{isChecking ? 'checking…' : at ? `checked ${ago(now - at)}` : ''}</Text>
        </Box>

        <Box flexGrow={1} />

        <Box flexDirection="column" marginTop={1}>
          <Text wrap="truncate-start"><Text color="inactive">{where.dir}</Text>{where.name}</Text>
          <Text>
            <Text color="success">• </Text>
            <Text color="inactive" bold>Claude</Text>
            <Text bold> Code</Text>
            {ver ? <Text color="inactive"> {ver}</Text> : null}
          </Text>
        </Box>
      </Box>
    )
  })
}
