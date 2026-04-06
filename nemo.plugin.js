/**
 * NemoClaw Plugin Entry Point
 *
 * This file registers the OpenClaw Command Center as a NemoClaw plugin.
 * NemoClaw (and compatible gateways) import this module and call
 * the default export's register() function to mount the Command Center
 * UI and API inside the gateway's own HTTP server.
 *
 * Usage — add to your NemoClaw config:
 *
 *   {
 *     "plugins": ["./path/to/openclaw-command-center"]
 *   }
 *
 * Or install from npm and reference by package name:
 *
 *   {
 *     "plugins": ["openclaw-command-center"]
 *   }
 *
 * The UI will be accessible at:
 *   https://<gateway-host>/plugins/command-center/
 *
 * The base path can be overridden:
 *   gateway.register(plugin, { basePath: '/my-custom-path' })
 */

import { register } from './server/index.js';
import pluginManifest from './plugin.json' with { type: 'json' };

export default {
  id: pluginManifest.id,
  name: pluginManifest.name,
  version: pluginManifest.version,
  description: pluginManifest.description,
  basePath: pluginManifest.basePath,
  capabilities: pluginManifest.capabilities,
  permissions: pluginManifest.permissions,

  /**
   * Called by the NemoClaw gateway to mount this plugin.
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
