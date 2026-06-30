import { createClient } from '@supabase/supabase-js';
import { WebSocket } from 'ws';
import { config } from './config.js';

// Lazy singleton: createClient() is deferred until the first method call on
// `supabase`. Importing this module must not demand live credentials — unit
// tests import runConnector.js (which imports us) but never invoke Supabase.
let _client;

function getClient() {
  return _client ??= createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth:     { persistSession: false },
    realtime: { transport: WebSocket },
  });
}

export const supabase = new Proxy({}, {
  get(_, prop) {
    const c = getClient();
    const val = c[prop];
    return typeof val === 'function' ? val.bind(c) : val;
  },
});
