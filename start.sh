#!/bin/bash
# OpenClaw Command Center - Kiosk Launcher
# Starts Node server + Chromium in kiosk mode for 7" LCD

set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "=== OpenClaw Command Center ==="

# Disable screen blanking
export DISPLAY=:0
xset s off 2>/dev/null || true
xset -dpms 2>/dev/null || true
xset s noblank 2>/dev/null || true

# Set USB audio volume to max (card 3 = USB audio)
amixer -c 3 sset Speaker 100% 2>/dev/null || true
amixer -c 3 sset PCM 100% 2>/dev/null || true

# Kill any existing instances
pkill -f "node server/index.js" 2>/dev/null || true
pkill -f "chromium.*command-center" 2>/dev/null || true

sleep 1

# Start Node server in background
echo "[start] Launching Node server..."
node server/index.js &
SERVER_PID=$!

# Wait for server to be ready
echo "[start] Waiting for server..."
for i in $(seq 1 20); do
  if curl -s http://localhost:3000/api/status > /dev/null 2>&1; then
    echo "[start] Server is ready!"
    break
  fi
  sleep 0.5
done

# Launch Chromium in kiosk mode
echo "[start] Launching Chromium kiosk..."
chromium-browser \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-translate \
  --no-first-run \
  --start-fullscreen \
  --window-size=800,480 \
  --window-position=0,0 \
  --app=http://localhost:3000 \
  2>/dev/null &

echo "[start] Command Center running! (Server PID: $SERVER_PID)"
echo "[start] Press Ctrl+C to stop"

# Wait for server process
wait $SERVER_PID
