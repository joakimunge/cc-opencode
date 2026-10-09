export type McpStatus = 'connected' | 'auth' | 'failed' | 'pending'

/** One server as `claude mcp list` reports it. */
export type McpServer = {
  /** the name to show: "Gmail", "Sanity" */
  name: string
  /** where it comes from: "claude.ai", "plugin sanity", "local" */
  source: string
  status: McpStatus
  /** the CLI's own words for the status: "Connected", "Needs authentication" */
  detail: string
}

export type Skill = { name: string; description: string }

/** Skills from one place: your own, the project's, claude.ai's, one plugin's. */
export type SkillGroup = { label: string; skills: Skill[] }

/** The Pulse stopwatch, as timer_status reports it. */
export type PulseTimer = {
  running: boolean
  project: string
  activity: string
  /** ms since the epoch the timer started; 0 when not running */
  since: number
  /** Pulse thinks it was forgotten (long running, or would be capped at 24 h) */
  forgotten: boolean
}

/** Logged hours from Pulse's my_time. */
export type Hours = { today: number; todayExpected: number; week: number; weekExpected: number }

/** One calendar event. Times are ms since the epoch. */
export type CalEvent = { title: string; start: number; end: number; allDay: boolean; where: string }

/** ok: events read · login: the connector needs /mcp · error: the call failed · checking: before the first read */
export type CalState = 'ok' | 'login' | 'error' | 'checking'

/** The session's context window and cost, as the status line reads them. */
export type Usage = { tokens: number; percent: number; usd: number }

declare module 'claude-code' {
  interface PluginState {
    toolbox: {
      servers: McpServer[]
      /** why the last check failed, '' when it didn't */
      mcpError: string
      /** ms since the epoch of the last finished check, 0 before the first */
      checkedAt: number
      checking: boolean
      skills: SkillGroup[]
      timer: PulseTimer | null
      hours: Hours | null
      /** why the last Pulse read failed, '' when it didn't */
      pulseError: string
      events: CalEvent[]
      calState: CalState
      calError: string
      /** ms since the epoch, ticked every 30 s so countdowns move */
      now: number
      /** tokens, % of the window and $ spent; null before the first response */
      usage: Usage | null
      /** the folder the session runs in */
      cwd: string
      /** Claude Code's version, "2.1.295" */
      version: string
    }
  }
}
