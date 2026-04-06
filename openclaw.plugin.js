/**
 * OpenClaw Plugin Entry Point
 *
 * This file wraps and exports `register()` with plugin metadata for gateways
 * that load plugin objects directly.
 */
   * @param {import('express').Application|import('express').Router} [gateway.app] — Express app/router
   * @param {import('express').Router} [gateway.router] — Alternate mount target
   * @param {import('http').Server} [gateway.server] — HTTP server (for WebSocket attachment)
import pluginManifest from './plugin.json' with { type: 'json' };

export default {
  id: pluginManifest.id,
  name: pluginManifest.name,
  version: pluginManifest.version,
  description: pluginManifest.description,
  basePath: pluginManifest.basePath,
  capabilities: pluginManifest.capabilities,
  permissions: pluginManifest.permissions,
  configSchema: pluginManifest.configSchema,

  /**
   * Called by the OpenClaw gateway to mount this plugin.
   *
   * @param {object} gateway
   * @param {import('express').Application} gateway.app    — Express app
   * @param {import('http').Server}         gateway.server — HTTP server
   * @param {string}                        [gateway.basePath] — override mount path
   * @param {EventEmitter|null}             [gateway.connection] — pre-auth WS
   * @param {object} [options]
   * @param {string} [options.basePath] — alternative override for mount path
   */
  register,
};

