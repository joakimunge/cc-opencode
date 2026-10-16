# opencode-look

Claude Code laid out like [OpenCode](https://opencode.ai), **in your own theme's colours**, with an OpenCode-style side pane.

Two plugins, install either or both:

| Plugin | What it draws |
|---|---|
| **opencode-look** | Your messages in a block with an accent bar · replies with coloured **bold**, *italics*, `code`, list numbers and headings · a gutter so everything breathes · `▣  Done · Opus 5.5 · 27.5s` after each turn · `Claude · Opus 5.5 · xhigh` under the prompt |
| **toolbox** | A side pane like OpenCode's sidebar: the folder as title · **Context** (tokens, % used, $ spent) · **Pulse** timer and hours · **Next up** from Google Calendar · **MCP** servers and their status · **Skills** · folder and Claude Code version at the bottom |

## Install

From GitHub, typed at the Claude Code prompt:

```
/plugin install opencode-look --marketplace joakimunge/cc-opencode
/plugin install toolbox --marketplace joakimunge/cc-opencode
```

From a local clone:

```sh
git clone git@github.com:joakimunge/cc-opencode.git
claude plugin marketplace add ./cc-opencode
claude plugin install opencode-look@opencode-look
claude plugin install toolbox@opencode-look
```

## Colours come from your theme

Nothing is a fixed colour. Each part uses a role, and the role is a key of whatever theme you picked with `/theme`:

| Role | Theme key | In the Synthwave theme |
|---|---|---|
| Accent: the bar, `▣`, headings, bullets | `claude` | pink |
| **Bold** | `bashBorder` | orange |
| *Italics* | `warning` | yellow |
| `Code` | `success` | green |
| List numbers, links | `suggestion` | cyan |
| Quiet text | `inactive` | lavender |
| Your message block | `userMessageBackground` | dark purple |

### Want OpenCode's exact look?

`themes/opencode.json` is OpenCode's *Synthwave '84* as a Claude Code theme:

```sh
cp themes/opencode.json ~/.claude/themes/
```

Then pick **OpenCode (Synthwave '84)** in `/theme`, and set your terminal's background to `#262335`. Claude Code draws on the terminal's own background.

### Prefer something quieter?

`themes/opencode-graphite.json` keeps the same pink, cyan and orange accents on muted greys instead of purples:

```sh
cp themes/opencode-graphite.json ~/.claude/themes/
```

Pick **OpenCode (Graphite)** in `/theme`, and set your terminal's background to `#1f1f22`, a soft charcoal rather than black.

### Using tmux?

Inside tmux, Claude Code limits itself to 256 colours, which turns dark purples into flat grey. Add this to the `env` block of `~/.claude/settings.json` and restart:

```json
"CLAUDE_CODE_TMUX_TRUECOLOR": "1"
```

## The side pane

- Opens by itself when a session starts (from about 110 columns wide in fullscreen).
- Hides when the terminal gets narrower than 110 columns, rather than stacking above the prompt, and comes back when you widen it.
- `/toolbox` opens it again · `/toolbox refresh` reads everything now · `/toolbox close` closes it · `r` refreshes · `s` stops the Pulse timer (it asks first).
- **Pulse** needs an MCP server named `pulse`. **Next up** needs the *claude.ai Google Calendar* connector; until it's logged in (`/mcp`) the pane says so.
- MCP status comes from `claude mcp list`, 15 s after the session starts and every 2 minutes after.

## What it can't change

- The pane's **×** and the line beside it (the drag handle that resizes it) are Claude Code's own.
- The prompt box itself, and the plugins' load notices, are drawn by Claude Code and keep their place.

## Developing

Each plugin is a hooks module (`hooks/register.tsx`) with pure helpers beside it and `*.test.ts` tests.

```sh
claude plugin validate plugins/opencode-look   # what the module hooks and calls
claude plugin test plugins/opencode-look       # the tests
```

To run your working copy in every session with live reload, list the plugin folders in `CLAUDE_CODE_PLUGIN_DIRS` (colon-separated) in the `env` block of `~/.claude/settings.json`.
