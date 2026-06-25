import { ErrorBoundary } from '@sentry/react';

function FallbackUI({ resetError }) {
  return (
    <div style={{
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      minHeight:      '100vh',
      padding:        '2rem',
      fontFamily:     'system-ui, -apple-system, sans-serif',
      textAlign:      'center',
    }}>
      <p style={{ fontSize: '2rem', margin: '0 0 1rem' }}>⚠️</p>
      <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', fontWeight: 600 }}>
        Something went wrong
      </h2>
      <p style={{ color: '#6b7280', margin: '0 0 1.5rem', maxWidth: '24rem' }}>
        Our team has been notified. Please try refreshing the page.
      </p>
      <button
        onClick={resetError}
        style={{
          padding:      '0.5rem 1.25rem',
          background:   '#111827',
          color:        '#fff',
          border:       'none',
          borderRadius: '0.375rem',
          cursor:       'pointer',
          fontSize:     '0.875rem',
          fontWeight:   500,
        }}
      >
        Try again
      </button>
    </div>
  );
}

export default function AppErrorBoundary({ children }) {
  return (
    <ErrorBoundary fallback={({ resetError }) => <FallbackUI resetError={resetError} />}>
      {children}
    </ErrorBoundary>
  );
}
