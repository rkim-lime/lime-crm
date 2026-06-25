/**
 * Sentry initialization for the ingestion worker.
 *
 * This file must be imported FIRST in src/index.js so Sentry is ready
 * before any job execution code runs.
 *
 * No-op when SENTRY_DSN is absent (local dev, tests without the secret).
 */

import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn:              process.env.SENTRY_DSN,
    environment:      process.env.WORKER_ENV ?? 'production',
    tracesSampleRate: 0,    // errors only — no performance tracing
    sendDefaultPii:   false,
  });
}
