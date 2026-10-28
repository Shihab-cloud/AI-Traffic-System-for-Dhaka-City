'use client';

import { useEffect } from 'react';

/**
 * Last-resort boundary for a throw in the root layout itself.
 *
 * `error.tsx` sits *inside* the root layout, so it cannot catch a failure in
 * that layout or in the providers it mounts — the very failures that take the
 * whole app down rather than one page.
 *
 * This replaces the document, which is why it renders its own `<html>` and
 * `<body>`. That also means no theme, no MUI and no providers are available
 * here: anything this file imports has already had its chance to be the thing
 * that broke. Plain elements and inline styles only, deliberately.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Root layout error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '2rem',
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#fff',
          color: '#111',
        }}
      >
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Something went wrong</h1>
        <p style={{ margin: 0, maxWidth: '32rem', color: '#555' }}>
          The application failed to start. Reloading may fix it; if it keeps happening, contact
          support.
        </p>
        {error.digest && (
          <p style={{ margin: 0, fontSize: '0.75rem', color: '#777' }}>Reference: {error.digest}</p>
        )}
        <button
          type="button"
          onClick={reset}
          style={{
            padding: '0.6rem 1.5rem',
            fontSize: '1rem',
            cursor: 'pointer',
            border: '1px solid #111',
            borderRadius: '0.375rem',
            background: '#111',
            color: '#fff',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
