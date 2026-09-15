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
              <input type="hidden" name="expectedAnalystId" value={currentAnalyst.id} />
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

export function SignIn({ error, localDemo = false }: { error: string | null; localDemo?: boolean }) {
  return (
    <section className="panel">
      <h1>Sign in</h1>
      <p>Enter your work email and password to access the review console.</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <form className="sign-in-form" method="post" action="/sign-in">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required maxLength={254}
          autoComplete="username" autoCapitalize="none" spellCheck={false} />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required maxLength={256} autoComplete="current-password" />
        <button type="submit" className="btn btn-primary">Sign in</button>
      </form>
      <p className="muted">Signing out ends this session. Other signed-in sessions stay active.</p>
      {localDemo ? (
        <details>
          <summary>Public local demo credentials</summary>
          <p>Fictional users for local testing only. Shared password: <code>demo-password-2026</code>.</p>
          <ul>
            <li>grete.lindholm@northwind-demo.example — Analyst</li>
            <li>marta.ellison@northwind-demo.example — Senior analyst</li>
            <li>sofia.chen@northwind-demo.example — Compliance manager</li>
          </ul>
        </details>
      ) : null}
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
