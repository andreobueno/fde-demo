import type { ReactNode } from 'react';
import type { Analyst } from '../api/types.js';
import { humanise } from '../lib/format.js';

export interface LayoutProps {
  title: string;
  currentAnalyst: Analyst | null;
  toast?: string | undefined;
  children: ReactNode;
}

export function Layout({ title, currentAnalyst, toast, children }: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="htmx-config" content='{"includeIndicatorStyles":false,"historyCacheSize":0,"refreshOnHistoryMiss":true}' />
        <title>{`${title} · KYC Review Console`}</title>
        <link rel="stylesheet" href="/styles.css" />
        <script src="/htmx.min.js" defer />
        <script src="/app.js" defer />
      </head>
      <body hx-history="false">
        <header className="topbar">
          <a className="brand" href="/">
            KYC Review Console
          </a>
          {currentAnalyst ? (
            <form className="analyst-switcher" method="post" action="/sign-out">
              <span>Signed in as {currentAnalyst.name} ({humanise(currentAnalyst.role)})</span>
              <span className="muted analyst-id">{currentAnalyst.id}</span>
              <button type="submit" className="btn btn-small">Sign out / switch user</button>
            </form>
          ) : null}
        </header>
        <div id="toast" className={toast ? 'toast' : 'toast toast-hidden'} role="status" aria-live="polite">
          {toast ?? ''}
        </div>
        <main className="container">{children}</main>
        <div id="dialog-slot" />
      </body>
    </html>
  );
}

export function SignIn({ error }: { error: string | null }) {
  return (
    <section className="panel">
      <h1>Sign in</h1>
      <p>Use an access token issued to you by an administrator. Tokens expire after eight hours and can be revoked.</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <form method="post" action="/sign-in" autoComplete="off">
        <label htmlFor="access-token">Access token</label>
        <input id="access-token" name="accessToken" type="password" required
          minLength={43} maxLength={43} pattern="[A-Za-z0-9_-]{43}" autoComplete="off" spellCheck={false} />
        <button type="submit" className="btn btn-primary">Sign in</button>
      </form>
      <p className="muted">Signing out clears this browser’s credential. Ask an administrator to revoke the token.</p>
    </section>
  );
}

export interface ErrorPageProps {
  heading: string;
  message: string;
  detail?: string | undefined;
}

export function ErrorPanel({ heading, message, detail }: ErrorPageProps) {
  return (
    <section className="panel error-panel">
      <h1>{heading}</h1>
      <p>{message}</p>
      {detail ? <p className="muted">{detail}</p> : null}
      <p>
        <a className="btn" href="/">
          Back to queue
        </a>
      </p>
    </section>
  );
}
