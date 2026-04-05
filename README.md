# OpenClaw Command Center

![OpenClaw Command Center](public/openclaw_command_center.png)
A web-based AI command center featuring a pixel art office with 3 AI agents, voice interaction, and real-time system monitoring. Built for Raspberry Pi 5 + 7" touchscreen, but runs anywhere with Node.js.



## Quick Start

```bash
git clone <this-repo>
cd openclaw-command-center
npm install
cp .env.example .env
npm start
# Open http://localhost:3000
```

That's it. With zero config, the app runs in **demo mode** — full UI with simulated agent activity, no gateway or API keys needed.

## What You'll See

The UI has three zones:

- **Left** — Animated mascot (tap to talk to Jansky, the boss agent)
- **Right** — Pixel art office with 3 agents at desks, conference huddles, personality-driven wandering, real system metrics, weather widget, digital clock, kanban whiteboard, ambient sounds
- **Bottom** — Terminal log showing agent activity

### The Team

| Agent | ID | Role | Color | TTS Voice |
|-------|----|------|-------|-----------|
| **Jansky** | `main` | Boss/orchestrator | Gold | onyx (deep) |
| **Orbit** | `claw-1` | Coding/tasks | Cyan | echo (clear) |
| **Nova** | `claw-2` | Research/web | Purple | fable (warm) |

Tap an agent in the office to start recording a voice message for them. Tap again to send. Agents respond with per-character TTS voices.

### Office Features

- **Kanban whiteboard** — Real-time task board showing IDLE / BUSY / DONE columns with agent-colored dots. Tracks session uptime and task completion count.
- **Ambient sounds** — Subtle keyboard clicks when agents are working, a ding when tasks complete, and an hourly chime synced to the clock.
- **Time-aware behavior** — Agents visit the coffee machine more in the morning (7-9am), take more sofa breaks in the afternoon (2-4pm), and stay at their desks more during late night hours.
- **Server rack** — Real system metrics (CPU%, MEM%, DISK%, temperature) with color-coded bars and blinking LEDs for critical thresholds.
- **Weather widget** — Live weather from wttr.in with rain effect on walls.
- **Conference huddles** — Agents periodically gather at the round table with rotating discussion topics.

## Architecture

### Server (`server/`)

| File | Purpose |
|------|---------|
| `index.js` | Express + HTTPS/HTTP server, WebSocket, voice routes, agent CLI bridge, weather + health APIs |
| `openclaw-bridge.js` | Gateway RPC v3 WebSocket connection, event normalization, demo fallback |
| `voice.js` | Whisper STT + OpenAI TTS with per-agent voice selection |
| `config.js` | Environment config loader |

### Client (`public/`)

| File | Purpose |
|------|---------|
| `js/app.js` | Boot sequence, WebSocket client, event routing, tap-to-talk |
| `js/office.js` | Canvas pixel art office — agents, furniture, wandering AI, huddles, weather ambiance, health metrics, kanban whiteboard, ambient sounds, time-aware behavior |
| `js/voice.js` | Client-side recording, target agent selection, Web Audio playback (2x volume boost) |
| `js/mascot.js` | Mascot canvas animation + emotion states |
| `js/terminal.js` | Terminal log renderer |

### Data Flow

```
Browser (tap agent) → MediaRecorder → POST /api/voice/transcribe
  → Whisper STT → openclaw CLI → agent response
  → WebSocket broadcast → office animation + TTS playback
```

## Environment Variables

See `.env.example` for the full template.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `DEMO_MODE` | `true` | `true` = no gateway needed. `false` = connects to OpenClaw gateway |
| `GATEWAY_URL` | `ws://127.0.0.1:18789` | OpenClaw gateway WebSocket URL |
| `GATEWAY_TOKEN` | — | Gateway auth token (required when `DEMO_MODE=false`) |
| `OPENAI_API_KEY` | — | Enables Whisper STT + TTS voice features |
| `WEATHER_LOCATION` | `Kingston,Ontario,Canada` | City,Region,Country for the weather widget (via wttr.in) |

## Agent Configuration

### Agent config file

Copy the example to your OpenClaw config directory:

```bash
cp config/openclaw.json.example ~/.openclaw/openclaw.json
```

This defines 3 agents with cost-optimized models (kimi-k2.5 for the boss, minimax-m2.5 for sub-agents).

### System prompts

| Agent | Prompt location |
|-------|----------------|
| Jansky (main) | `agents/main/SYSTEM.md` → copy to `~/.openclaw/workspace/SYSTEM.md` |
| Orbit (claw-1) | `agents/claw-1/SYSTEM.md` (read from repo) |
| Nova (claw-2) | `agents/claw-2/SYSTEM.md` (read from repo) |

Sub-agent prompts emphasize speed: 1-3 sentences, no preamble, act-then-report, no markdown.

### Agent self-setup

If your OpenClaw agent can read files, point it at `SETUP.md` — it contains step-by-step instructions the agent can follow to configure everything automatically.

## Session Architecture & Cross-Channel Awareness

The Command Center runs its own **session** (`agent:main:main`) separate from other channels like Telegram. Each channel has independent conversation context, but all channels **share the same memory**.

This means:
- **Short-term context** (recent messages) is per-channel — what you say on Telegram stays in the Telegram thread, what you say via voice stays in the Command Center thread
- **Long-term memory** (distilled knowledge) is shared — if the agent learns something important on any channel, it remembers it everywhere
- The `session-memory` hook automatically flushes important context to shared memory before compaction

The agent is the same brain with separate short-term memory per channel, but unified long-term knowledge.

## Cost Optimization

Running 3 AI agents can get expensive. Here are copy-paste prompts and configs to keep costs down:

### 1. Use cheap models (default config)

The included `config/openclaw.json.example` already uses cost-optimized models:
- **kimi-k2.5** (Moonshot) for the boss — good reasoning, low cost
- **minimax-m2.5** (OpenRouter) for sub-agents — fast, cheap

### 2. Even cheaper sub-agents

For sub-agents that only need to execute simple tasks:

```
Switch claw-1 and claw-2 to openrouter/google/gemini-2.5-flash-lite. Keep main on kimi-k2.5.
```

### 3. Heartbeat cost optimization

Copy-paste this prompt to your agent:

```
Please configure my heartbeat settings for cost optimization:

1. Set heartbeat interval to every 60 minutes
2. Set heartbeat model to openrouter/google/gemini-2.5-flash-lite (the cheapest available)
3. Set heartbeat target to "last"

This keeps my cache warm while using the cheapest possible model for heartbeats.

Please confirm the changes and show me the updated heartbeat configuration.
```

### 4. Session management (cost control)

Copy-paste this prompt to your agent:

```
Please add this session management rule to my system prompt:

## Session Management (Cost Control)

You operate in sessions that accumulate context over time.

When to reset:
- After 30+ exchanges (context window > 100K tokens)
- After 30+ minutes of continuous conversation
- Before switching to a different task domain
- When you notice you've forgotten early context

How to reset: /reset

Best practice: At reset, output a 2-3 sentence summary of what you learned.
This preserves knowledge while clearing the context weight.

Confirm the changes and show me the updated system prompt.
```

### 5. Memory flush before compaction

Copy-paste this prompt to your agent:

```
Please enable memory flush before compaction with a soft threshold of 4000 tokens.
This prevents important context from being lost when sessions get compacted.

Confirm the changes are applied.
```

## Raspberry Pi Deployment

### Deploy from local machine

```bash
rsync -avz ./ jansky@<PI_IP>:/home/jansky/openclaw-command-center/ \
  --exclude node_modules --exclude .env --exclude .git
ssh jansky@<PI_IP> 'cd /home/jansky/openclaw-command-center && npm install'
```

### Generate HTTPS certs (required for Pi kiosk)

```bash
ssh jansky@<PI_IP>
cd /home/jansky/openclaw-command-center
openssl req -x509 -newkey rsa:2048 -keyout server/key.pem -out server/cert.pem -days 365 -nodes -subj '/CN=localhost'
```

### Start / restart on Pi

```bash
ssh jansky@<PI_IP> 'fuser -k 3000/tcp; sleep 1; cd /home/jansky/openclaw-command-center && nohup node server/index.js &>/tmp/openclaw.log &'
```

Or use the included `start.sh` which also sets audio volume and launches Chromium in kiosk mode.

### Audio on Pi

The Pi has no system-level master mixer for USB audio. Volume boost is handled via Web Audio API GainNode (2x) in the browser. `start.sh` also runs `amixer` to set hardware volume to 100%.

## Troubleshooting

### Server won't start — port in use

```bash
fuser -k 3000/tcp
npm start
```

### Gateway connection keeps dropping

Check that your connect frame uses RPC v3 format (`type: "req"`, `method: "connect"`). See `server/openclaw-bridge.js` for the correct handshake.

### Voice not working

- Check that `OPENAI_API_KEY` is set in `.env`
- The server logs `Voice: ENABLED` or `Voice: DISABLED` on startup

### `openclaw: command not found`

The binary is at `~/.local/bin/openclaw`. The server sets PATH explicitly, but if running manually, add it to your PATH:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### Sub-agents responding slowly

Sub-agents should use `--thinking off` (set in `server/index.js`). Their system prompts also instruct them to keep replies to 1-3 sentences.

### Weather widget shows wrong location

Set `WEATHER_LOCATION` in `.env` to your city (format: `City,Region,Country`).
