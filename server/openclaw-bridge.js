import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import config from './config.js';

// Demo events — idle only, no fake work or TTS-triggering responses
const DEMO_EVENTS = [
  { type: 'agent:idle', data: { agent: 'main', status: 'Standing by' } },
  { type: 'agent:idle', data: { agent: 'claw-1', status: 'Ready' } },
  { type: 'agent:idle', data: { agent: 'claw-2', status: 'Ready' } },
  { type: 'agent:idle', data: { agent: 'main', status: 'All systems nominal' } },
  { type: 'agent:idle', data: { agent: 'claw-1', status: 'Awaiting tasks' } },
  { type: 'agent:idle', data: { agent: 'claw-2', status: 'Standby' } },
];

let rpcId = 0;

export default class OpenClawBridge extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.demoIndex = 0;
    this.demoTimer = null;
    this.connected = false;
    this.connectAttempts = 0;
    this.maxConnectAttempts = 3;
  }

  start() {
    if (config.demoMode) {
      console.log('[bridge] Starting in DEMO mode');
      this.startDemo();
      return;
    }
    this.connectGateway();
  }

  stop() {
    if (this.demoTimer) clearTimeout(this.demoTimer);
    if (this.ws) this.ws.close();
  }

  // --- Demo Mode ---

  startDemo() {
    this.connected = true;
    this.emit('connected', { mode: 'demo' });
    this.scheduleDemoEvent();
  }

  scheduleDemoEvent() {
    const delay = 1500 + Math.random() * 3000;
    this.demoTimer = setTimeout(() => {
      const event = DEMO_EVENTS[this.demoIndex % DEMO_EVENTS.length];
      this.demoIndex++;
      this.emit('event', event);
      this.scheduleDemoEvent();
    }, delay);
  }

  // --- Gateway Connection (RPC v3) ---

  connectGateway() {
    this.connectAttempts++;
    console.log(`[bridge] Connecting to gateway at ${config.gatewayUrl} (attempt ${this.connectAttempts}/${this.maxConnectAttempts})`);

    if (this.connectAttempts > this.maxConnectAttempts) {
      this.fallbackToDemo();
      return;
    }

    try {
      this.ws = new WebSocket(config.gatewayUrl);
    } catch (err) {
      console.error('[bridge] Failed to create WebSocket:', err.message);
      this.fallbackToDemo();
      return;
    }

    let authenticated = false;

    this.ws.on('open', () => {
      console.log('[bridge] Gateway WebSocket open');
      this.reconnectDelay = 1000;
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        this.handleGatewayMessage(msg, () => { authenticated = true; });
      } catch (err) {
        console.error('[bridge] Failed to parse message:', err.message);
      }
    });

    this.ws.on('close', () => {
      console.log('[bridge] Gateway connection closed');
      const wasConnected = this.connected;
      this.connected = false;
      this.emit('disconnected');

      if (!authenticated && !wasConnected) {
        if (this.connectAttempts >= this.maxConnectAttempts) {
          this.fallbackToDemo();
          return;
        }
      }
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[bridge] Gateway error:', err.message);
    });
  }

  sendRpc(method, params) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    rpcId++;
    this.ws.send(JSON.stringify({
      type: 'req',
      id: String(rpcId),
      method,
      params,
    }));
  }

  handleGatewayMessage(msg, onAuth) {
    // RPC v3: connect.challenge event
    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      console.log('[bridge] Received connect challenge, authenticating...');
      this.sendRpc('connect', {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: 'gateway-client',
          displayName: 'OpenClaw Command Center',
          mode: 'backend',
          version: '1.0.0',
          platform: 'linux',
        },
        auth: {
          token: config.gatewayToken,
        },
      });
      return;
    }

    // RPC v3: connect response (hello-ok)
    if (msg.type === 'res' && msg.ok && msg.payload?.type === 'hello-ok') {
      console.log('[bridge] Gateway authenticated! Protocol v' + msg.payload.protocol);
      this.connected = true;
      this.connectAttempts = 0;
      onAuth();
      this.emit('connected', { mode: 'live' });
      return;
    }

    // RPC v3: connect error
    if (msg.type === 'res' && !msg.ok) {
      console.error('[bridge] Gateway RPC error:', msg.error?.message || JSON.stringify(msg.error));
      return;
    }

    // RPC v3: gateway events (agent activity, health, etc.)
    if (msg.type === 'event') {
      const normalized = this.normalizeEvent(msg);
      if (normalized) {
        this.emit('event', normalized);
      }
    }
  }

  normalizeEvent(msg) {
    const event = msg.event;
    const payload = msg.payload || {};

    // Map gateway event names to our internal format
    const eventMap = {
      'agent': null, // generic agent event — inspect payload
    };

    // Agent events come as event:"agent" with payload containing state info
    if (event === 'agent') {
      const agentId = payload.agentId || payload.agent || 'main';
      const state = payload.state || payload.event;
      const stateMap = {
        'idle': 'agent:idle',
        'listening': 'agent:listening',
        'thinking': 'agent:thinking',
        'tool_use': 'agent:tool_use',
        'tool_call': 'agent:tool_use',
        'responding': 'agent:responding',
        'response': 'agent:responding',
        'error': 'agent:error',
      };
      const type = stateMap[state];
      if (type) {
        return {
          type,
          data: {
            agent: agentId,
            ...payload,
          },
        };
      }
    }

    // Also handle dot-notation events from older format
    const dotMap = {
      'agent.listening': 'agent:listening',
      'agent.thinking': 'agent:thinking',
      'agent.tool_use': 'agent:tool_use',
      'agent.tool_call': 'agent:tool_use',
      'agent.responding': 'agent:responding',
      'agent.response': 'agent:responding',
      'agent.idle': 'agent:idle',
      'agent.error': 'agent:error',
    };

    const mappedType = dotMap[event];
    if (mappedType) {
      return {
        type: mappedType,
        data: {
          agent: payload.agent || payload.agent_id || 'main',
          ...payload,
        },
      };
    }

    return null;
  }

  scheduleReconnect() {
    console.log(`[bridge] Reconnecting in ${this.reconnectDelay}ms...`);
    setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.connectGateway();
    }, this.reconnectDelay);
  }

  fallbackToDemo() {
    if (this.connected) return;
    console.log('[bridge] Gateway unavailable, falling back to demo mode');
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.startDemo();
  }

  getStatus() {
    return {
      connected: this.connected,
      mode: config.demoMode ? 'demo' : (this.connected ? 'live' : 'disconnected'),
      gatewayUrl: config.gatewayUrl,
    };
  }
}
