// Reading what the pane shows. Pure: no engine calls, so the tests run it directly.
import type { McpServer, McpStatus, Skill } from '../types'

/** The servers in `claude mcp list` output: lines of `<name>: <url or command> - <mark> <status>`. */
export function parseMcpList(stdout: string): McpServer[] {
  const out: McpServer[] = []
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    const dash = line.lastIndexOf(' - ')
    const colon = line.indexOf(': ')
    if (dash < 0 || colon < 0 || colon > dash) continue
    const full = line.slice(0, colon)
    const detail = line.slice(dash + 3).replace(/^[^\p{L}]+/u, '').trim()
    let name = full
    let source = 'local'
    if (full.startsWith('claude.ai ')) {
      name = full.slice('claude.ai '.length)
      source = 'claude.ai'
    } else if (full.startsWith('plugin:')) {
      const parts = full.split(':')
      source = `plugin ${parts[1] ?? ''}`.trim()
      name = parts.slice(2).join(':') || parts[1] || full
    }
    out.push({ name, source, status: statusOf(detail), detail })
  }
  return out
}

export function statusOf(detail: string): McpStatus {
  if (/\b(not connected|disconnected)\b/i.test(detail)) return 'failed'
  if (/\bconnected\b/i.test(detail)) return 'connected'
  if (/auth|log ?in|sign ?in/i.test(detail)) return 'auth'
  if (/fail|error|unable|refused|timed? ?out/i.test(detail)) return 'failed'
  return 'pending'
}

const ORDER: Record<McpStatus, number> = { connected: 0, auth: 1, failed: 2, pending: 3 }

/** Connected first, then needs-login, failed, pending; by name within each. */
export function sortServers(servers: McpServer[]): McpServer[] {
  return [...servers].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name))
}

/** A skill's `name` and `description` from the front matter of its SKILL.md (or a command's .md). */
export function parseSkill(text: string, fallbackName: string): Skill {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''
  const field = (key: string) => {
    const m = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(fm)
    return (m?.[1] ?? '').trim().replace(/^["']|["']$/g, '')
  }
  return { name: field('name') || fallbackName, description: field('description') }
}

/** "just now", "3 min ago", "2 h ago" */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  return `${Math.round(m / 60)} h ago`
}
