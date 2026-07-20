# @xjuai/pi-feishu-lark

<p align="center">
  <b>English</b> | <a href="./README.zh-CN.md">简体中文</a>
</p>

Feishu / Lark bridge extension for the [Pi](https://github.com/earendil-works/pi) coding agent.

A refactor-style fork of [AX1202/pi-feishu-lark](https://github.com/AX1202/pi-feishu-lark) (MIT), hardened for Docker daemon mode and production alert workflows.

## Architecture

```text
┌──────────────────────────────────────────────────────────────────────────┐
│  Runtime (Pi extension / Docker worker / optional daemon)                │
│  gateway-lock · config · health · debug log                              │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
        ┌───────────────────────▼───────────────────────┐
        │  Feishu Transport                             │
        │  WS long-connection · SDK · card actions      │
        │  send/reply (text · post · interactive)       │
        │  getMessage (quoted parent/root) · retries    │
        └───────────────────────┬───────────────────────┘
                                │ InboundEvent
        ┌───────────────────────▼───────────────────────┐
        │  Inbound Pipeline                             │
        │  dedupe → group policy → parseMessageInput    │
        │  extractors: text / post / interactive / file │
        │  quote expand → commands (/new /model /…)     │
        └───────────────────────┬───────────────────────┘
                                │ AgentRequest
        ┌───────────────────────▼───────────────────────┐
        │  Session Orchestrator (ConversationManager)   │
        │  conversation key → Pi session                │
        │  per-key queue · model/workspace · stop       │
        │  configurable prompt / queue timeouts         │
        └───────────────────────┬───────────────────────┘
                                │ stream events + final
        ┌───────────────────────▼───────────────────────┐
        │  Pi Session Port                              │
        │  createAgentSession · prompt · abort          │
        │  SessionManager (on-disk sessions)            │
        └───────────────────────┬───────────────────────┘
                                │ deltas + final text
        ┌───────────────────────▼───────────────────────┐
        │  Outbound Presenter                           │
        │  CardKit streaming (fallback → plain reply)   │
        │  rich-text mode · chunking · retries          │
        │  task-status card · bridge (scheduled jobs)   │
        └───────────────────────────────────────────────┘
```

**Message flow (happy path):**

```text
Feishu user / alert card
    → Transport (WS)
    → dedupe + parse (interactive / quote)
    → ConversationManager.prompt
    → Pi agent turn
    → StreamingReply / replyText
    → Feishu chat
```

## Changes vs upstream

- **Inbound interactive card parsing** — alert-bot cards become readable text for the agent
- **Quoted / parent message expansion** — when a user replies to a card and @mentions the bot, parent/root body is fetched into the prompt
- **Configurable timeouts** — default prompt / queue wait is 1h (overridable via env)
- **Outbound retries** — exponential backoff for retriable Feishu API errors
- **Streaming replies** — CardKit streaming cards, with plain-text fallback on failure
- **Upstream features kept** — `/workspace`, resume cards, gateway lock, daemon, model switch
- **Commands** — added `/status`, `/commands`

## Branching, versioning & releases

| Item | Policy |
|------|--------|
| Default branch | `main` (always releasable) |
| Feature work | short-lived `feat/*` / `fix/*` / `docs/*` PRs into `main` |
| Versioning | [SemVer](https://semver.org/) via [Conventional Commits](https://www.conventionalcommits.org/) |
| Release automation | [Release Please](https://github.com/googleapis/release-please) opens a Release PR; merge → `vX.Y.Z` tag + GitHub Release |
| npm publish | `publish.yml` on `release: published` (`npm publish --access public --provenance`) |

See [CONTRIBUTING.md](./CONTRIBUTING.md) for commit types and the full flow.

## Install

```bash
# Local path (Docker / monorepo)
pi install /path/to/packages/pi-feishu-lark -a

# Or npm (when published)
pi install npm:@xjuai/pi-feishu-lark -a
```

## Usage

```text
/feishu setup
/feishu start
```

**In Feishu:** `/new` `/resume` `/model` `/workspace` `/status` `/stop` `/commands`

**In Pi:** `/feishu setup` `/feishu start` `/feishu stop` `/feishu restart` `/feishu status` `/feishu autostart` `/feishu debug` `/feishu reset`

## Configuration

`~/.pi/agent/feishu/config.json` or environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | — | App credentials |
| `FEISHU_DOMAIN` | `feishu` | `feishu` / `lark` |
| `FEISHU_GROUP_POLICY` | `open` | `open` (all messages) / `mention` (@ required) |
| `FEISHU_PARSE_INTERACTIVE_CARDS` | `true` | Parse inbound interactive cards |
| `FEISHU_INCLUDE_QUOTED_MESSAGE` | `true` | Expand quoted/parent messages |
| `FEISHU_QUOTED_MESSAGE_MAX_CHARS` | `8000` | Max chars for quoted body |
| `FEISHU_PROMPT_TIMEOUT_MS` | `3600000` | Per-turn prompt timeout (ms) |
| `FEISHU_QUEUE_WAIT_TIMEOUT_MS` | `3600000` | Wait timeout for previous turn |
| `FEISHU_SEND_MAX_RETRIES` | `2` | Outbound API retries (excluding first try) |
| `FEISHU_STREAMING_REPLY` | `true` | Stream final reply text on the same card |
| `FEISHU_STREAM_FLUSH_MS` | `400` | Min interval between stream card patches (ms) |
| `FEISHU_STREAM_MIN_CHARS` | `1` | Min new chars before a stream patch |
| `FEISHU_STREAM_MAX_BODY_CHARS` | `12000` | Max reply body chars on the card |
| `FEISHU_AUTO_START` | `true` | Auto-connect when Pi starts |
| `FEISHU_LANGUAGE` | `zh` | `zh` / `en` |

## On-disk state

| Path | Content |
|------|---------|
| `~/.pi/agent/feishu/config.json` | Credentials and config |
| `~/.pi/agent/feishu/state.json` | Feishu ↔ Pi session mapping |
| `~/.pi/agent/feishu/bridge.json` | Routes (e.g. scheduled jobs) |
| `~/.pi/agent/feishu/debug.log` | Debug log |
| `~/.pi/agent/sessions/` | Per-conversation Pi session files |

## Development

```bash
npm install
npm run check
npm test
```

## FAQ

**Bot does not reply?**

- Confirm the Feishu app and permissions are configured
- Confirm `/feishu start` is running
- Under `mention` policy, users must @ the bot; under `open`, enable “read all group messages”

**Agent cannot see alert card content?**

- Ensure `FEISHU_PARSE_INTERACTIVE_CARDS=true`
- When users reply to a card, ensure `FEISHU_INCLUDE_QUOTED_MESSAGE=true` and message-read scope is granted

## License

MIT (upstream [AX1202/pi-feishu-lark](https://github.com/AX1202/pi-feishu-lark))
