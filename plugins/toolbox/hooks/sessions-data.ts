// Reading the open Claude sessions. Pure: no engine calls, so the tests run it directly.
//  - each running Claude Code process keeps ~/.claude/sessions/<pid>.json up to date: its name, folder and status
//  - a file can outlive its process, and a pid can be reused, so a session counts as open only while `ps` reports a
//    process with that pid that started when the file says (`procStart`, ps's own lstart, written in UTC)
import type { ClaudeSession } from '../types'

/** One ~/.claude/sessions/<pid>.json, or null when it isn't one. */
export function parseSession(text: string): ClaudeSession | null {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
  const num = (k: string) => (typeof raw[k] === 'number' ? (raw[k] as number) : 0)
  const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : '')
  const pid = num('pid')
  const sessionId = str('sessionId')
  if (!pid || !sessionId) return null
  const startedAt = num('startedAt')
  return {
    pid,
    sessionId,
    name: str('name'),
    cwd: str('cwd'),
    status: str('status') || 'unknown',
    kind: str('kind'),
    procStart: str('procStart'),
    startedAt,
    since: num('statusUpdatedAt') || num('updatedAt') || startedAt,
  }
}

const squash = (s: string) => s.trim().replace(/\s+/g, ' ')

/** pid → start time from `ps -o pid=,lstart=` output */
export function parseStarts(stdout: string): Map<number, string> {
  const out = new Map<number, string>()
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(.+)$/.exec(line)
    if (m) out.set(Number(m[1]), squash(m[2] ?? ''))
  }
  return out
}

/** The sessions whose process is still the one that wrote the file: working ones first, then the latest active. */
export function openSessions(list: ClaudeSession[], starts: Map<number, string>): ClaudeSession[] {
  return list
    .filter((s) => {
      const started = starts.get(s.pid)
      return started !== undefined && (!s.procStart || started === squash(s.procStart))
    })
    .sort((a, b) => Number(b.status === 'busy') - Number(a.status === 'busy') || b.since - a.since)
}

/** "now", "4 min", "2 h", "3 d" */
export function age(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`
}
