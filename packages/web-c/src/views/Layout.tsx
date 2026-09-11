import type { ReactNode } from 'react';
import type { Analyst } from '../api/types.js';

export interface LayoutProps {
  title: string;
  analysts: Analyst[];
  currentAnalystId: string;
  returnTo: string;
  toast?: string | undefined;
  children: ReactNode;
}

export function Layout({ title, analysts, currentAnalystId, returnTo, toast, children }: LayoutProps) {
  const current = analysts.find((a) => a.id === currentAnalystId);
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="htmx-config" content='{"includeIndicatorStyles":false}' />
        <title>{`${title} · KYC Review Console`}</title>
        <link rel="stylesheet" href="/styles.css" />
        <script src="/htmx.min.js" defer />
        <script src="/app.js" defer />
      </head>
      <body>
        <header className="topbar">
          <a className="brand" href="/">
            KYC Review Console
          </a>
          <form
            className="analyst-switcher"
            method="post"
            action="/switch-analyst"
            hx-post="/switch-analyst"
            hx-trigger="change"
            hx-swap="none"
          >
            <input type="hidden" name="returnTo" value={returnTo} />
            <label htmlFor="analyst-select">Acting as</label>
            <select id="analyst-select" name="analystId" defaultValue={currentAnalystId}>
              {analysts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.role === 'senior_analyst' ? 'senior' : 'analyst'})
                </option>
              ))}
            </select>
            {current ? <span className="muted analyst-id">{current.id}</span> : null}
            <button type="submit" className="btn btn-small no-js-only">
              Switch
            </button>
          </form>
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
