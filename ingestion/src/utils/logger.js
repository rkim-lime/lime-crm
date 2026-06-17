const ts = () => new Date().toISOString().slice(11, 19);

export const logger = {
  info:  (...a) => console.log( `[${ts()}] INFO `, ...a),
  warn:  (...a) => console.warn(`[${ts()}] WARN `, ...a),
  error: (...a) => console.error(`[${ts()}] ERROR`, ...a),
  debug: (...a) => { if (process.env.DEBUG) console.log(`[${ts()}] DEBUG`, ...a); },
};
