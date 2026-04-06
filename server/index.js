/**
 * OpenClaw Command Center - SECURE VERSION
 *
 * Supports two run modes:
 *   - Standalone: `node server/index.js` creates its own HTTP/HTTPS server (default)
 *   - Plugin:     gateway calls `register(gateway, options)` and mounts the app
 *                 at a sub-path inside the existing gateway server
 *
 * Security:
 * - API Key authentication
 * - Rate limiting
 * - Helmet security headers (standalone only)
 * - Input validation
 * - WebSocket authentication
 * - Security logging
 * - CORS protection (standalone only)
 */

import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync, existsSync, statfsSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import os from 'node:os';
import multer from 'multer';
import crypto from 'node:crypto';
import helmet from 'helmet';
import cors from 'cors';
import config from './config.js';
import OpenClawBridge from './openclaw-bridge.js';
import { transcribe, speak } from './voice.js';
import {
  requireAuth,
  rateLimit,
  isValidApiKey,
  createSession,
  validateSession,
  logSecurityEvent,
  getSecurityLog,
} from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Prevent repeated plugin re-registration from spawning multiple bridge loops.
let pluginMounted = false;
let pluginBridgeStarted = false;

// ============================================
// INPUT VALIDATION
// ============================================

const VALID_AGENTS = ['main', 'researcher', 'coder', 'engineer', 'assistant'];

function validateAgentName(agent) {
  if (!agent || typeof agent !== 'string') return 'main';
  const sanitized = agent.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '');
  return VALID_AGENTS.includes(sanitized) ? sanitized : 'main';
}

function validateMessage(message) {
  if (!message || typeof message !== 'string') {
    throw new Error('Message is required and must be a string');
  }
  if (message.length > 10000) {
    throw new Error('Message exceeds maximum length of 10000 characters');
  }
  // Remove potential command injection characters
  return message.replace(/[\x00-\x1f\x7f]/g, '').trim();
}

// ============================================
// COMMAND CENTER FACTORY
//
// Builds all routes, WebSocket handling, and the bridge for one instance.
// Called in both standalone and plugin modes with different basePath values.
//
//   basePath = ''                      → standalone (routes live at /)
//   basePath = '/plugins/command-center' → plugin (routes live under that prefix)
//
// Returns:
//   router        — Express Router with all HTTP routes
//   initWebSocket — call with the HTTP server; wires up the WSS
//   initBridge    — call after initWebSocket; returns { start() }
// ============================================

function buildCommandCenter(basePath) {
  // Shared mutable context — populated by initWebSocket / initBridge below.
  // broadcast is initialized to a no-op so routes can call it safely during
  // the brief window between router mount and WebSocket initialization.
  // It is replaced with the real implementation by initWebSocket().
  let broadcast = () => 0;
  let wss = null;
  let bridge = null;

  const publicDir = join(__dirname, '..', 'public');

  const router = express.Router();

  // Body parsing (needed in both standalone and plugin modes)
  router.use(express.json({ limit: '1mb' }));
  router.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Request ID for tracking
  router.use((req, res, next) => {
    req.id = crypto.randomBytes(8).toString('hex');
    res.setHeader('X-Request-ID', req.id);
    next();
  });

  // Request logging
  router.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`[request] ${req.method} ${req.path} ${res.statusCode} ${duration}ms (${req.id})`);
    });
    next();
  });

  // ---- FILE UPLOAD CONFIGURATION ----

  const ALLOWED_AUDIO_TYPES = [
    'audio/webm', 'audio/wav', 'audio/mpeg', 'audio/mp3',
    'audio/ogg', 'audio/mp4', 'audio/x-m4a',
  ];

  const audioFileFilter = (req, file, cb) => {
    if (ALLOWED_AUDIO_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      logSecurityEvent('invalid_file_type', {
        ip: req.ip, mimetype: file.mimetype, originalname: file.originalname,
      });
      cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: ${ALLOWED_AUDIO_TYPES.join(', ')}`), false);
    }
  };

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: audioFileFilter,
  });

  // ---- STATIC FILES ----
  // Serve js/config.js dynamically so the frontend knows the plugin base path
  // without requiring an inline script (which would need 'unsafe-inline' in CSP).
  router.get('/js/config.js', (req, res) => {
    res.type('application/javascript');
    res.set('Cache-Control', 'no-store');
    res.send(`window.__BASE__ = ${JSON.stringify(basePath)};`);
  });

  router.get(['/', '/index.html'], (req, res) => {
    try {
      res.sendFile(join(publicDir, 'index.html'));
    } catch (err) {
      console.error('[server] Failed to serve index.html:', err.message);
      res.status(500).send('Internal Server Error');
    }
  });

  router.use(express.static(publicDir, {
    index: false, // handled above
    maxAge: '1h',
    etag: true,
    lastModified: true,
  }));

  // ---- PUBLIC ENDPOINTS ----

  router.get('/api/health', rateLimit({ windowMs: 60000, maxRequests: 120 }), (req, res) => {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memPct = Math.round(((totalMem - freeMem) / totalMem) * 100);
    const loadAvg = os.loadavg()[0];
    const cpuPct = Math.min(100, Math.round((loadAvg / cpus.length) * 100));
    let diskPct = 0;
    try {
      const fsStats = statfsSync('/');
      const total = Number(fsStats.blocks || 0);
      const available = Number(fsStats.bavail || 0);
      if (total > 0) {
        diskPct = Math.round(((total - available) / total) * 100);
      }
    } catch {
      diskPct = 0;
    }

    let tempC = 0;
    try {
      const thermalPath = '/sys/class/thermal/thermal_zone0/temp';
      if (existsSync(thermalPath)) {
        const raw = readFileSync(thermalPath, 'utf8').trim();
        tempC = Math.round((parseInt(raw, 10) || 0) / 1000);
      }
    } catch {
      tempC = 0;
    }

    res.json({
      cpu_pct: cpuPct,
      mem_pct: memPct,
      disk_pct: diskPct,
      temp_c: tempC,
      uptime: Math.floor(os.uptime()),
    });
  });

  // Local browser token — no API key needed, localhost only
  router.get('/api/auth/local-token', rateLimit({ windowMs: 60000, maxRequests: 30 }), (req, res) => {
    const ip = req.socket.remoteAddress;
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
      return res.status(403).json({ error: 'Local access only' });
    }
    const token = createSession('local-browser');
    res.json({ token });
  });

  // ---- PROTECTED ENDPOINTS ----

  router.post('/api/auth/session', rateLimit({ windowMs: 60000, maxRequests: 10 }), (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey) {
      return res.status(400).json({ error: 'API key required in request body' });
    }
    if (!isValidApiKey(apiKey)) {
      logSecurityEvent('failed_auth_attempt', { ip: req.ip });
      return res.status(403).json({ error: 'Invalid API key' });
    }
    const sessionToken = createSession(apiKey);
    logSecurityEvent('session_created', { ip: req.ip });
    res.json({ success: true, sessionToken, expiresIn: 86400 });
  });

  router.get('/api/status', requireAuth, rateLimit({ windowMs: 60000, maxRequests: 120 }), (req, res) => {
    res.json({
      uptime: process.uptime(),
      bridge: bridge ? bridge.getStatus() : { connected: false, mode: 'initializing' },
      clients: wss ? wss.clients.size : 0,
      voiceEnabled: config.hasVoice,
      authenticated: true,
    });
  });

  let weatherCache = { data: null, ts: 0 };
  router.get('/api/weather', requireAuth, rateLimit({ windowMs: 60000, maxRequests: 60 }), async (req, res) => {
    const now = Date.now();
    if (weatherCache.data && now - weatherCache.ts < 600000) {
      return res.json(weatherCache.data);
    }
    try {
      const location = (config.weatherLocation || '').replace(/[^a-zA-Z0-9,\s-]/g, '').slice(0, 100);
      const resp = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`);
      if (!resp.ok) throw new Error(`Weather API returned ${resp.status}`);
      const json = await resp.json();
      const cur = json.current_condition?.[0] || {};
      const data = {
        temp_c: parseInt(cur.temp_C) || 0,
        feels_like: parseInt(cur.FeelsLikeC) || 0,
        desc: cur.weatherDesc?.[0]?.value || 'Unknown',
        code: parseInt(cur.weatherCode) || 0,
        humidity: parseInt(cur.humidity) || 0,
        wind_kph: parseInt(cur.windspeedKmph) || 0,
        location: location.split(',')[0],
      };
      weatherCache = { data, ts: now };
      res.json(data);
    } catch (err) {
      console.error('[weather] Error:', err.message);
      res.json(weatherCache.data || { temp_c: 0, desc: 'Unavailable', code: 0 });
    }
  });

  router.get('/api/security/log', requireAuth, rateLimit({ windowMs: 60000, maxRequests: 10 }), (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    res.json({ events: getSecurityLog(limit), timestamp: new Date().toISOString() });
  });

  // ---- AGENT COMMUNICATION ----

  function sendToAgent(agentId, message, requestId) {
    const target = validateAgentName(agentId);
    const sanitizedMessage = validateMessage(message);

    console.log(`[agent] Sending to ${target}: "${sanitizedMessage.slice(0, 80)}..." (request: ${requestId})`);

    broadcast({
      type: 'agent:thinking',
      data: { agent: target, status: 'Processing...', requestId },
    });

    const thinkingLevel = target === 'main' ? 'low' : 'off';

    if (!bridge || !bridge.connected) {
      console.error(`[agent] Bridge not connected, cannot send to ${target}`);
      logSecurityEvent('agent_error', { agent: target, error: 'Bridge not connected', requestId });
      broadcast({
        type: 'agent:error',
        data: { agent: target, message: 'Gateway not connected', requestId },
      });
      return;
    }

    const sent = bridge.sendToAgent(target, sanitizedMessage, thinkingLevel);
    if (!sent) {
      console.error(`[agent] Failed to send to ${target} via bridge`);
      logSecurityEvent('agent_error', { agent: target, error: 'Bridge send failed', requestId });
      broadcast({
        type: 'agent:error',
        data: { agent: target, message: 'Failed to relay message to gateway', requestId },
      });
      return;
    }

    // Agent response is streamed back via gateway events and bridged to clients.
    console.log(`[agent] Message relayed to gateway for ${target} (request: ${requestId})`);
  }

  // ---- VOICE ENDPOINTS ----

  router.post(
    '/api/voice/transcribe',
    requireAuth,
    rateLimit({ windowMs: 60000, maxRequests: 20 }), // Strict limit - costs money!
    upload.single('audio'),
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: 'No audio file provided' });
        }
        const targetAgent = validateAgentName(req.body?.targetAgent);
        const requestId = req.id;
        console.log(`[voice] Transcribing ${req.file.size} bytes for agent: ${targetAgent} (request: ${requestId})`);
        const text = await transcribe(req.file.buffer, req.file.originalname || 'audio.webm');
        if (typeof text !== 'string' || text.length > 5000) {
          throw new Error('Invalid transcription result');
        }
        console.log(`[voice] Transcribed: "${text.slice(0, 100)}"`);
        broadcast({ type: 'voice:transcription', data: { text, agent: targetAgent, timestamp: Date.now(), requestId } });
        sendToAgent(targetAgent, text, requestId);
        res.json({ text, agent: targetAgent, requestId });
      } catch (err) {
        console.error('[voice] Transcription error:', err.message);
        logSecurityEvent('transcription_error', { error: err.message, ip: req.ip });
        res.status(500).json({ error: 'Transcription failed' });
      }
    }
  );

  router.post(
    '/api/voice/speak',
    requireAuth,
    rateLimit({ windowMs: 60000, maxRequests: 30 }), // Strict limit - costs money!
    async (req, res) => {
      try {
        const { text, agent } = req.body;
        if (!text || typeof text !== 'string') {
          return res.status(400).json({ error: 'Text is required' });
        }
        if (text.length > 2000) {
          return res.status(400).json({ error: 'Text exceeds maximum length of 2000 characters' });
        }
        const validatedAgent = validateAgentName(agent);
        console.log(`[voice] Speaking as ${validatedAgent}: "${text.slice(0, 80)}..."`);
        const { audio, contentType } = await speak(text, validatedAgent);
        res.set('Content-Type', contentType);
        res.set('Content-Length', audio.length);
        res.set('Cache-Control', 'no-store');
        res.send(audio);
      } catch (err) {
        console.error('[voice] TTS error:', err.message);
        logSecurityEvent('tts_error', { error: err.message, ip: req.ip });
        res.status(500).json({ error: 'Speech synthesis failed' });
      }
    }
  );

  // ---- ERROR HANDLERS ----

  router.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  router.use((err, req, res, next) => {
    console.error('[error]', err.message);
    const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
    res.status(err.status || 500).json({ error: message });
  });

  // ---- WEBSOCKET SETUP ----

  function initWebSocket(server) {
    // In plugin mode set a path so our WSS only handles its own upgrade
    // requests and doesn't interfere with the gateway's other WS connections.
    const wsPath = basePath ? basePath + '/ws' : undefined;
    const wssOpts = wsPath ? { server, path: wsPath } : { server };
    wss = new WebSocketServer(wssOpts);

    wss.on('connection', (ws, req) => {
      const clientIp = req.socket.remoteAddress;
      let isAuthenticated = false;

      console.log(`[ws] Client connected from ${clientIp} (total: ${wss.clients.size})`);

      ws.send(JSON.stringify({
        type: 'auth:required',
        data: { message: 'Please authenticate with your session token' },
      }));

      const authTimeout = setTimeout(() => {
        if (!isAuthenticated) {
          ws.send(JSON.stringify({ type: 'auth:timeout', data: { message: 'Authentication timeout' } }));
          ws.close(1008, 'Authentication timeout');
        }
      }, 10000);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === 'auth' && msg.token) {
            if (validateSession(msg.token)) {
              isAuthenticated = true;
              clearTimeout(authTimeout);
              ws.send(JSON.stringify({
                type: 'auth:success',
                data: { ...(bridge ? bridge.getStatus() : { connected: false, mode: 'initializing' }), voiceEnabled: config.hasVoice },
              }));
              logSecurityEvent('ws_authenticated', { ip: clientIp });
              console.log(`[ws] Client authenticated from ${clientIp}`);
            } else {
              logSecurityEvent('ws_auth_failed', { ip: clientIp });
              ws.send(JSON.stringify({ type: 'auth:failed', data: { message: 'Invalid session token' } }));
              ws.close(1008, 'Authentication failed');
            }
            return;
          }

          if (!isAuthenticated) {
            ws.send(JSON.stringify({ type: 'error', data: { message: 'Authentication required' } }));
            return;
          }

          console.log(`[ws] Received: ${msg.type}`);
        } catch (err) {
          console.error('[ws] Error processing message:', err.message);
        }
      });

      ws.on('close', () => {
        console.log(`[ws] Client disconnected from ${clientIp} (total: ${wss.clients.size})`);
        clearTimeout(authTimeout);
      });

      ws.on('error', (err) => {
        console.error(`[ws] Error from ${clientIp}:`, err.message);
        logSecurityEvent('ws_error', { ip: clientIp, error: err.message });
      });
    });

    broadcast = (msg) => {
      const payload = JSON.stringify(msg);
      let sent = 0;
      for (const client of wss.clients) {
        if (client.readyState === 1) {
          client.send(payload);
          sent++;
        }
      }
      return sent;
    };
  }

  // ---- BRIDGE SETUP ----

  function initBridge(injectedConnection = null) {
    bridge = new OpenClawBridge();

    bridge.on('connected', (info) => {
      console.log(`[bridge] Connected (${info.mode} mode)`);
      broadcast({ type: 'bridge:connected', data: info });
    });

    bridge.on('disconnected', () => {
      broadcast({ type: 'bridge:disconnected' });
    });

    bridge.on('event', (event) => {
      broadcast(event);
    });

    return {
      start: () => bridge.start(injectedConnection),
    };
  }

  return { router, initWebSocket, initBridge };
}

// ============================================
// PLUGIN MODE EXPORT
//
// Called by the OpenClaw gateway:
//
//   import { register } from 'openclaw-command-center';
//   register(gateway, { basePath: '/plugins/command-center' });
//
// gateway shape (any compatible subset):
//   gateway.app / gateway.router / gateway.use(...) — Express mount target
//   gateway.server / gateway.httpServer / gateway.http.server — HTTP server for WebSocket attachment
//   gateway.basePath   — Optional: override mount path
//   gateway.connection — Optional: pre-established gateway WS connection
// ============================================

export function register(gateway, options = {}) {
  const basePath = gateway?.basePath
    || options.basePath
    || config.pluginBasePath
    || '/plugins/command-center';

  // Use gateway object as key for idempotency (survives module reloads within same gateway)
  const registrationKey = Symbol.for(`command-center-registered-${basePath}`);
  if (gateway && gateway[registrationKey]) {
    console.log(`[plugin] Command Center already registered for ${basePath}; skipping`);
    return { ok: true, basePath, reused: true };
  }

  const pickMountTarget = (ctx) => {
    const candidates = [
      ctx?.app,
      ctx?.router,
      ctx?.http?.app,
      ctx?.httpApp,
      ctx?.runtime?.app,
      ctx?.runtime?.router,
      ctx?.runtime?.http?.app,
      ctx?.runtime?.httpApp,
      ctx,
    ];
    return candidates.find((c) => c && typeof c.use === 'function') || null;
  };

  const pickServer = (ctx) => {
    const candidates = [
      ctx?.server,
      ctx?.httpServer,
      ctx?.http?.server,
    ];
    return candidates.find((c) => c && typeof c.on === 'function') || null;
  };

  const pickConnection = (ctx) => ctx?.connection ?? ctx?.gatewayConnection ?? ctx?.ws ?? null;

  try {
    console.log(`[plugin] Registering Command Center at ${basePath}`);

    const { router, initWebSocket, initBridge } = buildCommandCenter(basePath);
    const mountTarget = pickMountTarget(gateway);
    let mounted = false;

    if (mountTarget) {
      // Traditional Express app.use mount
      mountTarget.use(basePath, router);
      mounted = true;
      console.log('[plugin] Mounted routes via Express app.use()');
    } else if (gateway && typeof gateway.registerHttpRoute === 'function') {
      // OpenClaw plugin API mount - registerHttpRoute(path, handler)
      try {
        gateway.registerHttpRoute(basePath, router);
        mounted = true;
        console.log('[plugin] Mounted routes via gateway.registerHttpRoute()');
      } catch (err) {
        console.warn(`[plugin] registerHttpRoute failed: ${err?.message}`);
      }
    }

    if (!mounted) {
      console.warn(`[plugin] No HTTP mount available; skipping route mount for ${basePath}`);
      return { ok: true, basePath, mounted: false, skipped: 'no_mount_target' };
    }

    // Mark as registered on the gateway object (persists across module reloads)
    if (gateway) {
      gateway[registrationKey] = true;
    }

    // Setup WebSocket if server available
    const server = pickServer(gateway);
    if (server) {
      initWebSocket(server);
    } else {
      console.warn('[plugin] No HTTP server handle on gateway; WebSocket disabled');
    }

    // Start bridge (only once per gateway instance)
    const { start: startBridge } = initBridge(pickConnection(gateway));
    const started = startBridge();
    if (started && typeof started.then === 'function') {
      started.catch((err) => {
        console.error('[plugin] Bridge start failed:', err?.message);
      });
    }

    const wsLabel = server ? `${basePath}/ws` : 'disabled';
    console.log(`[plugin] Command Center ready — UI: ${basePath}/  WS: ${wsLabel}`);
    return { ok: true, basePath, ui: `${basePath}/`, ws: wsLabel, mounted: true };
  } catch (err) {
    console.error('[plugin] Registration failed:', err?.message);
    return { ok: false, error: err?.message };
  }
}


// ============================================
// STANDALONE MODE
//
// Run directly with: node server/index.js  (or npm start)
// ============================================

async function main() {
  const app = express();

  app.set('trust proxy', process.env.TRUST_PROXY === 'true');

  // Helmet security headers (standalone only — gateway provides these in plugin mode)
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "wss:", "https:"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  }));

  // CORS (standalone only)
  const corsOptions = {
    origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://localhost:3000'],
    credentials: true,
    optionsSuccessStatus: 200,
    maxAge: 86400,
  };
  app.use(cors(corsOptions));

  const { router, initWebSocket, initBridge } = buildCommandCenter('');
  app.use(router);

  // HTTPS/HTTP server setup
  const certPath = join(__dirname, 'cert.pem');
  const keyPath = join(__dirname, 'key.pem');
  const useHttps = existsSync(certPath) && existsSync(keyPath);

  let server;
  if (useHttps) {
    server = createHttpsServer({
      cert: readFileSync(certPath),
      key: readFileSync(keyPath),
      secureOptions: crypto.constants.SSL_OP_NO_SSLv3 | crypto.constants.SSL_OP_NO_TLSv1 | crypto.constants.SSL_OP_NO_TLSv1_1,
    }, app);
    console.log('[server] TLS enabled with secure options');
  } else {
    server = createHttpServer(app);
    console.log('[server] WARNING: Running without TLS. Use reverse proxy with SSL for production!');
  }

  // Attach WebSocket (no path filter in standalone — we own the whole server)
  initWebSocket(server);

  // Prepare bridge (started inside listen callback so the server is ready first)
  const { start: startBridge } = initBridge(null);

  const bindAddress = process.env.BIND_ADDRESS || '127.0.0.1';

  server.listen(config.port, bindAddress, () => {
    const proto = useHttps ? 'https' : 'http';
    console.log('========================================');
    console.log('[server] OpenClaw Command Center SECURE');
    console.log('========================================');
    console.log(`[server] Listening on ${proto}://${bindAddress}:${config.port}`);
    console.log(`[server] TLS: ${useHttps ? 'ENABLED' : 'DISABLED (use reverse proxy!)'}`);
    console.log(`[server] Voice: ${config.hasVoice ? `ENABLED (TTS: ${config.ttsProvider}, STT: ${config.sttProvider})` : 'DISABLED'}`);
    console.log(`[server] Auth: REQUIRED for all API endpoints`);
    console.log(`[server] CORS: ${corsOptions.origin.join(', ')}`);
    console.log('========================================');

    if (!useHttps && bindAddress !== '127.0.0.1') {
      console.warn('[server] WARNING: Running HTTP on non-localhost. Use HTTPS or reverse proxy!');
    }

    startBridge();
  });
}

// Run standalone when invoked directly (npm start / node server/index.js).
// When imported as a plugin, only the exported `register` function is used.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
