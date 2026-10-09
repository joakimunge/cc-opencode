import { expect, test } from 'claude-code/testing'
import {
  commas, money, splitPath, countdown, duration, hours, localDate, parseEvents, parseHours, parseTime, parseTimer, payload, pickListTool, upcoming, when,
} from './workday-data'

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()
const NOW = at(2026, 10, 9, 13, 35)

test('reads the JSON block of an MCP result, skipping notes', () => {
  const r = { content: [{ type: 'text', text: '{"running":false}' }, { type: 'text', text: 'Names are free text…' }] }
  expect(payload(r)).toEqual({ running: false })
  expect(payload({ content: [], structuredContent: { a: 1 } })).toEqual({ a: 1 })
})

test('a stopped timer', () => {
  expect(parseTimer({ running: false }, NOW)).toEqual({ running: false, project: '', activity: '', since: 0, forgotten: false })
})

test('a running timer, from since or from runningForHours', () => {
  const t = parseTimer({ running: true, project: { name: 'Loadbuilder' }, activity: 'Development', since: '2026-10-09T09:00:00Z' }, NOW)
  expect([t.project, t.activity, t.since, t.forgotten]).toEqual(['Loadbuilder', 'Development', Date.parse('2026-10-09T09:00:00Z'), false])
  const u = parseTimer({ running: true, project: 'Internal', runningForHours: 1.5, longRunning: true }, NOW)
  expect([u.since, u.forgotten]).toEqual([NOW - 90 * 60_000, true])
})

test("today's and this week's hours from my_time", () => {
  const myTime = {
    toDate: { week: { worked: 34, expected: 40 } },
    thisMonthByDay: { days: [{ date: '2026-10-08', worked: 8, expected: 8 }, { date: '2026-10-09', worked: 2.25, expected: 8 }] },
  }
  expect(parseHours(myTime, '2026-10-09')).toEqual({ today: 2.25, todayExpected: 8, week: 34, weekExpected: 40 })
  expect(parseHours(myTime, '2026-10-12')).toEqual({ today: 0, todayExpected: 0, week: 34, weekExpected: 40 })
})

test('times: date-times and bare dates', () => {
  expect(parseTime({ dateTime: '2026-10-09T14:00:00+02:00' })).toEqual({ ms: Date.parse('2026-10-09T14:00:00+02:00'), allDay: false })
  expect(parseTime({ date: '2026-10-10' })).toEqual({ ms: at(2026, 10, 10), allDay: true })
  expect(parseTime('nonsense')).toBe(null)
})

test('finds events wherever the list sits, drops cancelled ones', () => {
  const google = {
    items: [
      { summary: 'Standup', start: { dateTime: new Date(at(2026, 10, 9, 14)).toISOString() }, end: { dateTime: new Date(at(2026, 10, 9, 14, 15)).toISOString() } },
      { summary: 'Gone', status: 'cancelled', start: { dateTime: '2026-10-09T15:00:00Z' } },
      { summary: 'Holiday', start: { date: '2026-10-10' }, end: { date: '2026-10-11' } },
    ],
  }
  const list = parseEvents({ result: google })
  expect(list.map((e) => e.title)).toEqual(['Standup', 'Holiday'])
  expect(parseEvents([{ title: 'Flat', start: '2026-10-09T16:00:00Z', location: 'Room 2' }])[0]?.where).toBe('Room 2')
})

test('upcoming: not ended, timed only, soonest first', () => {
  const ev = (title: string, s: number, e: number, allDay = false) => ({ title, start: s, end: e, allDay, where: '' })
  const list = [ev('later', at(2026, 10, 9, 16), at(2026, 10, 9, 17)), ev('done', at(2026, 10, 9, 9), at(2026, 10, 9, 10)),
    ev('now', at(2026, 10, 9, 13), at(2026, 10, 9, 14)), ev('day', at(2026, 10, 9), at(2026, 10, 10), true)]
  expect(upcoming(list, NOW).map((e) => e.title)).toEqual(['now', 'later'])
})

test('picks the list-events tool, not the login or free-time ones', () => {
  const p = 'mcp__claude_ai_Google_Calendar__'
  expect(pickListTool([`${p}authenticate`, `${p}complete_authentication`], p)).toBe(null)
  expect(pickListTool([`${p}find_free_time`, `${p}list_events`, `${p}get_event`], p)).toBe('list_events')
  expect(pickListTool([`${p}list_gcal_events`], p)).toBe('list_gcal_events')
  expect(pickListTool([`${p}search_calendar_events`], p)).toBe('search_calendar_events')
})

test('words for times', () => {
  expect([duration(25 * 60_000), duration(80 * 60_000), duration(3 * 3_600_000)]).toEqual(['25 min', '1 h 20 min', '3 h'])
  expect(when(at(2026, 10, 9, 14), NOW)).toBe('14:00')
  expect(when(at(2026, 10, 10, 9), NOW)).toBe('Tomorrow 09:00')
  expect(when(at(2026, 10, 12, 9), NOW)).toBe('Mon 09:00')
  const meeting = { title: 'x', start: at(2026, 10, 9, 14), end: at(2026, 10, 9, 14, 30), allDay: false, where: '' }
  expect(countdown(meeting, NOW)).toBe('in 25 min')
  expect(countdown(meeting, at(2026, 10, 9, 14, 10))).toBe('now · 20 min left')
  expect([hours(7.5), hours(8), hours(2.25)]).toEqual(['7.5', '8', '2.25'])
  expect(localDate(NOW)).toBe('2026-10-09')
})

test('sidebar words: token counts, money, paths', () => {
  expect([commas(64115), commas(999), commas(1234567)]).toEqual(['64,115', '999', '1,234,567'])
  expect([money(0.3214), money(12.4)]).toEqual(['$0.32', '$12.40'])
  expect(splitPath('/Users/me/dev/_labs/music', '/Users/me')).toEqual({ dir: '~/dev/_labs/', name: 'music' })
  expect(splitPath('/Users/me', '/Users/me')).toEqual({ dir: '', name: '~' })
  expect(splitPath('/opt/x', '/Users/me')).toEqual({ dir: '/opt/', name: 'x' })
})

test('Google Calendar: all-day dates with a time, declined events, lists of rooms', () => {
  const list = parseEvents({
    events: [
      { summary: 'Kim Birthday', start: { date: '2026-10-11T00:00:00Z' }, end: { date: '2026-10-12T00:00:00Z' } },
      { summary: 'Skipped', start: { dateTime: '2026-10-09T15:00:00+02:00' }, attendees: [{ self: true, responseStatus: 'declined' }] },
      { summary: 'Stand Down', start: { dateTime: '2026-10-09T16:30:00+02:00' }, end: { dateTime: '2026-10-09T16:50:00+02:00' },
        location: 'Barcelona-Carme (5), Uppsala-Hamilton (6), Stockholm-Lovelace (12)', attendees: [{ self: true, responseStatus: 'accepted' }] },
    ],
  })
  expect(list.map((e) => [e.title, e.allDay])).toEqual([['Kim Birthday', true], ['Stand Down', false]])
  expect(list[0]?.start).toBe(new Date(2026, 9, 11).getTime())
  expect(list[1]?.where).toBe('Barcelona-Carme (5) +2')
})
