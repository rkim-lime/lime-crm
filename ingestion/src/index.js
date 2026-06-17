import { config }    from './config.js';    // validates env vars at startup
import { ingest13F } from './pipeline/ingest13F.js';
import { logger }    from './utils/logger.js';

// Prevent unused-import lint warnings — config is imported for its side effects
void config;

const [,, command, ...flags] = process.argv;

function flagValue(name) {
  const idx = flags.indexOf(name);
  return idx !== -1 ? flags[idx + 1] : null;
}

const limit = parseInt(flagValue('--limit') ?? '50', 10);

if (command === 'ingest-13f') {
  logger.info(`Command: ingest-13f (limit=${limit})`);
  const stats = await ingest13F({ limit });
  logger.info(`Done — prospects:${stats.prospects} filings:${stats.filings} holdings:${stats.holdings} errors:${stats.errors}`);
} else {
  console.error(`Unknown command: ${command ?? '(none)'}`);
  console.error('Usage: node src/index.js ingest-13f [--limit N]');
  process.exit(1);
}
