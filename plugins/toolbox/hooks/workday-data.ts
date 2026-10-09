// Reading what the pane shows. Pure: no engine calls, so the tests run it directly.
import type { CalEvent, Hours, PulseTimer } from '../types'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)
/** a name field that may be a string or `{ name }` */
const nameOf = (v: unknown): string => (isObj(v) ? str(v.name ?? v.title) : str(v))

/** An MCP result's payload: its structured content, or the first text block that parses as JSON. */
export function payload(result: { content: { type: string; text?: string }[]; structuredContent?: unknown }): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent
  for (const block of result.content) {
    if (block.type !== 'text' || !block.text) continue
    try {
      return JSON.parse(block.text)
    } catch {
      // a note, not the data
    }
  }
  return undefined
}

/** The text of an MCP result, for error messages. */
export function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((b) => b.text ?? '').join(' ').trim()
}

/** A date or date-time as ms since the epoch. A bare date ("2026-10-09") is local midnight. */
export function parseTime(v: unknown): { ms: number; allDay: boolean } | null {
  if (isObj(v)) {
    const at = v.dateTime ?? v.date_time
    // Google gives an all-day event a `date`, sometimes with a midnight time on it: the day is what counts
    return at !== undefined ? parseTime(at) : parseTime(str(v.date).slice(0, 10))
  }
  const s = str(v)
  if (!s) return null
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (day) return { ms: new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).getTime(), allDay: true }
  const ms = Date.parse(s)
  return Number.isNaN(ms) ? null : { ms, allDay: false }
}

/** timer_status → PulseTimer. `fetchedAt` places a timer that only says how long it has run. */
export function parseTimer(v: unknown, fetchedAt: number): PulseTimer {
  const o = isObj(v) ? v : {}
  const running = o.running === true
  if (!running) return { running: false, project: '', activity: '', since: 0, forgotten: false }
  const since = parseTime(o.since ?? o.startedAt ?? o.started)?.ms ?? fetchedAt - num(o.runningForHours) * 3_600_000
  return {
    running,
    project: nameOf(o.project),
    activity: nameOf(o.activity),
    since,
    forgotten: o.longRunning === true || o.wouldBeCappedAt24 === true,
  }
}

/** my_time → today's and this week's hours. `today` is the local date, "2026-10-09". */
export function parseHours(v: unknown, today: string): Hours | null {
  if (!isObj(v)) return null
  const week = isObj(v.toDate) && isObj(v.toDate.week) ? v.toDate.week : {}
  const days = isObj(v.thisMonthByDay) && Array.isArray(v.thisMonthByDay.days) ? v.thisMonthByDay.days : []
  const day = days.find((d): d is Obj => isObj(d) && d.date === today)
  return {
    today: num(day?.worked),
    todayExpected: num(day?.expected),
    week: num(week.worked),
    weekExpected: num(week.expected),
  }
}

/** Every event in a calendar result, wherever the list sits ("events", "items", the top level…). */
export function parseEvents(v: unknown): CalEvent[] {
  const out: CalEvent[] = []
  const seen = new Set<unknown>()
  const visit = (x: unknown, depth: number) => {
    if (depth > 5 || seen.has(x)) return
    seen.add(x)
    if (Array.isArray(x)) {
      for (const item of x) visit(item, depth + 1)
      return
    }
    if (!isObj(x)) return
    const start = 'start' in x ? parseTime(x.start) : null
    if (start) {
      if (str(x.status) === 'cancelled') return
      const me = Array.isArray(x.attendees) ? x.attendees.find((a) => isObj(a) && a.self === true) : undefined
      if (isObj(me) && me.responseStatus === 'declined') return
      const end = parseTime(x.end)?.ms ?? start.ms + (start.allDay ? 86_400_000 : 3_600_000)
      out.push({
        title: str(x.summary ?? x.title ?? x.name) || '(no title)',
        start: start.ms,
        end,
        allDay: start.allDay,
        where: place(str(x.location)),
      })
      return
    }
    for (const value of Object.values(x)) visit(value, depth + 1)
  }
  visit(v, 0)
  return out
}

/** "Room A +3" for a list of rooms, the first one and how many more */
function place(location: string): string {
  const rooms = location.split(/,\s+/).filter(Boolean)
  return rooms.length > 1 ? `${rooms[0]} +${rooms.length - 1}` : location
}

/** Timed events that haven't ended yet, soonest first. All-day ones are left out: they aren't appointments. */
export function upcoming(events: CalEvent[], now: number): CalEvent[] {
  return events.filter((e) => !e.allDay && e.end > now).sort((a, b) => a.start - b.start)
}

/** The calendar tool that lists events, from the session's tool names; null while only the login tools exist. */
export function pickListTool(names: string[], prefix: string): string | null {
  const tools = names.filter((n) => n.startsWith(prefix)).map((n) => n.slice(prefix.length))
  return (
    tools.find((t) => /^list_?(gcal_)?events$/i.test(t)) ??
    tools.find((t) => /(list|search|find).*events?|events?.*(list|search)/i.test(t) && !/free|busy/i.test(t)) ??
    null
  )
}

/** "25 min", "1 h 20 min", "3 h" */
export function duration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
}

const pad = (n: number) => String(n).padStart(2, '0')
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "2026-10-09" in local time */
export function localDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** "14:00" today, "Mon 09:00" on another day */
export function when(ms: number, now: number): string {
  const d = new Date(ms)
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (localDate(ms) === localDate(now)) return clock
  const tomorrow = localDate(now + 86_400_000) === localDate(ms)
  return `${tomorrow ? 'Tomorrow' : DAYS[d.getDay()]} ${clock}`
}

/** "in 25 min", "now · 10 min left" */
export function countdown(e: CalEvent, now: number): string {
  return e.start > now ? `in ${duration(e.start - now)}` : `now · ${duration(e.end - now)} left`
}

/** "7.5" for hours, without a trailing ".0" */
export const hours = (h: number): string => String(Math.round(h * 100) / 100)

/** "just now", "3 min ago" */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

/** "64,115" */
export function commas(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** "$0.32", "$12.40" */
export const money = (usd: number): string => `$${usd.toFixed(2)}`

/** A path split for the footer: the folder dimmed, the last name bright, home as "~". */
export function splitPath(path: string, home: string): { dir: string; name: string } {
  const p = home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path
  const cut = p.lastIndexOf('/')
  return cut < 0 ? { dir: '', name: p } : { dir: p.slice(0, cut + 1), name: p.slice(cut + 1) }
}
