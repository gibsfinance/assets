/**
 * Preload for running the server or the collector on plain `node`:
 *
 *   node --import ./src/bin/register-hooks.ts ./src/bin/server.ts
 *
 * See `runtime/node-hooks.ts` for what the hooks do and why.
 */
import { register } from 'node:module'

register('../runtime/node-hooks.ts', import.meta.url)
