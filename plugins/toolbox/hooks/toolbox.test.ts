import { expect, test } from 'claude-code/testing'
import { ago, parseMcpList, parseSkill, sortServers, statusOf } from './data'

const SAMPLE = `Checking MCP server health…

claude.ai Claude Docs: https://api.anthropic.com/v1/pages/mcp - ✔ Connected
claude.ai AMA: https://mimir.example.net/mcp - ! Needs authentication
claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected
plugin:sanity:Sanity: https://mcp.sanity.io (HTTP) - ! Needs authentication
filesystem: npx -y @modelcontextprotocol/server-filesystem /tmp - ✗ Failed to connect
`

test('reads every server, its source and status', () => {
  const list = parseMcpList(SAMPLE)
  expect(list.map((s) => [s.name, s.source, s.status])).toEqual([
    ['Claude Docs', 'claude.ai', 'connected'],
    ['AMA', 'claude.ai', 'auth'],
    ['Gmail', 'claude.ai', 'connected'],
    ['Sanity', 'plugin sanity', 'auth'],
    ['filesystem', 'local', 'failed'],
  ])
  expect(list[1]?.detail).toBe('Needs authentication')
})

test('connected first, then needs login, then failed', () => {
  expect(sortServers(parseMcpList(SAMPLE)).map((s) => s.name)).toEqual(['Claude Docs', 'Gmail', 'AMA', 'Sanity', 'filesystem'])
})

test('status words', () => {
  expect(statusOf('Connected')).toBe('connected')
  expect(statusOf('Not connected')).toBe('failed')
  expect(statusOf('Needs authentication')).toBe('auth')
  expect(statusOf('Failed to connect')).toBe('failed')
  expect(statusOf('Pending')).toBe('pending')
})

test('ignores lines that are not servers', () => {
  expect(parseMcpList('Checking MCP server health…\n\nNo MCP servers configured. Use `claude mcp add`.\n')).toEqual([])
})

test('reads a skill front matter', () => {
  const text = '---\nname: vvaharness\ndescription: "Operate the vvaharness SAST CLI"\n---\n\n# Body'
  expect(parseSkill(text, 'x')).toEqual({ name: 'vvaharness', description: 'Operate the vvaharness SAST CLI' })
  expect(parseSkill('# no front matter', 'typegen')).toEqual({ name: 'typegen', description: '' })
})

test('ages', () => {
  expect(ago(10_000)).toBe('just now')
  expect(ago(3 * 60_000)).toBe('3 min ago')
  expect(ago(2 * 3_600_000)).toBe('2 h ago')
})
