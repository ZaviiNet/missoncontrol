# OpenClaw Command Center — Agent Setup Instructions

These are step-by-step instructions for an OpenClaw agent to self-configure the Command Center. Follow them in order.

---

## Step 1: Check Prerequisites

Verify the following are installed:
- **Node.js 18+** — run `node --version` (must be v18 or higher)
- **npm** — run `npm --version`
- **OpenClaw CLI** — run `openclaw --version` (only needed if `DEMO_MODE=false`)

If Node.js is missing, install it from https://nodejs.org or via your package manager.

## Step 2: Install Dependencies

```bash
npm install
```

This installs Express, WebSocket, Multer, OpenAI SDK, and dotenv.

## Step 3: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and set:

| Variable | Required? | Description |
|----------|-----------|-------------|
| `DEMO_MODE` | No | `true` (default) runs without a gateway. Set `false` for real agents. |
| `GATEWAY_TOKEN` | If `DEMO_MODE=false` | Your OpenClaw gateway auth token |
| `OPENAI_API_KEY` | For voice | Enables Whisper STT + TTS. Leave blank to disable voice. |
| `WEATHER_LOCATION` | No | City,Region,Country for weather widget (default: Kingston,Ontario,Canada) |
| `PORT` | No | Server port (default: 3000) |
| `GATEWAY_URL` | No | Gateway WebSocket URL (default: ws://127.0.0.1:18789) |

## Step 4: Set Up Agent Config (skip if DEMO_MODE=true)

Copy the example agent config to the OpenClaw config directory:

```bash
mkdir -p ~/.openclaw
cp config/openclaw.json.example ~/.openclaw/openclaw.json
```

Edit `~/.openclaw/openclaw.json` to set your preferred models and providers.

## Step 5: Set Up Agent System Prompts (skip if DEMO_MODE=true)

The main agent (Jansky) reads its prompt from `~/.openclaw/workspace/SYSTEM.md`:

```bash
mkdir -p ~/.openclaw/workspace
cp agents/main/SYSTEM.md ~/.openclaw/workspace/SYSTEM.md
```

Sub-agent prompts are read from their directories in this repo — verify they exist:

```bash
ls agents/claw-1/SYSTEM.md
ls agents/claw-2/SYSTEM.md
```

## Step 6: Optional — Generate HTTPS Certs

Only needed if your browser requires HTTPS (e.g., Chromium kiosk on Pi):

```bash
openssl req -x509 -newkey rsa:2048 -keyout server/key.pem -out server/cert.pem -days 365 -nodes -subj '/CN=localhost'
```

The server auto-detects `server/cert.pem` + `server/key.pem` and uses HTTPS if found, otherwise falls back to HTTP.

## Step 7: Start the Server

```bash
npm start
```

## Step 8: Verify

Open http://localhost:3000 (or https://localhost:3000 if you generated certs).

You should see:
- **Left zone**: Animated mascot
- **Right zone**: Pixel art office with 3 agents at desks, furniture, wall widgets
- **Bottom zone**: Terminal log

If `DEMO_MODE=true`, the bridge will run in demo mode and the office will animate with simulated agent activity.

## Step 9: Report to User

Tell the user:
- The server is running on port 3000
- Whether demo mode or live gateway mode is active
- Whether voice is enabled (depends on OPENAI_API_KEY)
- The weather widget location
