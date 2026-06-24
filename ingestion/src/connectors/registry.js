/** @type {Map<string, import('./types.js').Connector>} */
const registry = new Map();

/** @param {import('./types.js').Connector} connector */
export function register(connector) {
  registry.set(connector.key, connector);
}

/** @param {string} key @returns {import('./types.js').Connector | null} */
export function getConnector(key) {
  return registry.get(key) ?? null;
}

/** @returns {import('./types.js').Connector[]} */
export function listConnectors() {
  return [...registry.values()];
}
