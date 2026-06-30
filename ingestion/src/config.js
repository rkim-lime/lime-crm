import 'dotenv/config';

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

// Lazy getters: required() is called only when the property is first READ,
// not at module-import time. Importing config.js must not demand live
// credentials — unit tests import connector code without injecting secrets.
export const config = {
  get supabaseUrl()        { return required('SUPABASE_URL'); },
  get supabaseServiceKey() { return required('SUPABASE_SERVICE_KEY'); },
  get secUserAgent()       { return required('SEC_USER_AGENT'); },
};
