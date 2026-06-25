import * as Sentry from '@sentry/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn:              import.meta.env.VITE_SENTRY_DSN,
    environment:      import.meta.env.MODE,  // 'production' or 'development'
    tracesSampleRate: 0,                     // errors only — no performance tracing
    sendDefaultPii:   false,
    beforeSend(event) {
      // Strip cookies, auth headers, and user identity — no PII in error reports.
      // Lime CRM users are financial firm employees; we don't need identity for triage.
      if (event.request) {
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers['Authorization'];
          delete event.request.headers['Cookie'];
        }
      }
      delete event.user;
      return event;
    },
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
