import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { Fragment, createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiError, ApiUnreachableError, SESSION_TOKEN_PATTERN } from './api/client.js';
import type { ApiClient } from './api/client.js';
import { CASE_ACTIONS } from './api/types.js';
import type { Analyst, AuthenticatedAnalyst, CaseAction, CaseDetail } from './api/types.js';
import { verifyChain } from './lib/audit.js';
import { parseFilters, queueUrl } from './lib/filters.js';
import { ACTION_LABELS, normaliseNote, validateNote } from './lib/validation.js';
import { ActionDialog, CaseMain, NotFoundCase } from './views/CasePage.js';
import { ErrorPanel, Layout, SignIn } from './views/Layout.js';
import { QueuePage, QueueResults } from './views/QueuePage.js';

const AUTH_NOTICES = {
  validation: 'Enter a valid email address and password.',
  'invalid-credentials': 'Incorrect email or password.',
  throttled: 'Too many sign-in attempts. Try again later.',
  unavailable: 'Sign-in is unavailable right now. Please try again.',
  'logout-failed': 'This browser is signed out, but the API could not confirm session revocation. The server session may remain active until it expires. Contact an administrator.',
};
type AuthNotice = keyof typeof AUTH_NOTICES;

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join('; ');

const DONE_MESSAGES: Record<CaseAction, string> = {
  start_review: 'Review started.',
  approve: 'Case approved.',
  reject: 'Case rejected.',
  escalate: 'Case escalated.',
};

export interface AppOptions {
  api: ApiClient;
  publicDir?: string;
}

interface RequestContext {
  analysts: Analyst[];
  analyst: AuthenticatedAnalyst;
  accessToken: string;
  isHx: boolean;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(value);
      } catch {
        out[key] = value;
      }
    }
  }
  return out;
}

function isCaseAction(value: string): value is CaseAction {
  return (CASE_ACTIONS as readonly string[]).includes(value);
}

function html(element: ReactElement): string {
  return `<!doctype html>\n${renderToStaticMarkup(element)}`;
}

function fragment(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

export function createApp({ api, publicDir }: AppOptions) {
  const insecureLocalAuth = process.env.ALLOW_INSECURE_LOCAL_AUTH === 'true';
  if (insecureLocalAuth && process.env.NODE_ENV === 'production') {
    throw new Error('ALLOW_INSECURE_LOCAL_AUTH is not permitted in production.');
  }
  const localDemo = process.env.LOCAL_DEMO_AUTH === 'true';
  if (localDemo && process.env.NODE_ENV === 'production') {
    throw new Error('LOCAL_DEMO_AUTH is not permitted in production.');
  }
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  const authCookie = process.env.SESSION_COOKIE_NAME ?? `kyc_session_${port}`;
  if (!/^[A-Za-z0-9_-]+$/.test(authCookie) || ['analyst_id', 'kyc_access_token'].includes(authCookie)) {
    throw new Error('SESSION_COOKIE_NAME must be a unique cookie name using letters, digits, underscores or hyphens.');
  }
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: !insecureLocalAuth,
    path: '/',
  };
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  function clearCredential(res: Response) {
    res.clearCookie(authCookie, cookieOptions);
    res.clearCookie('kyc_access_token', cookieOptions);
    res.clearCookie('analyst_id', cookieOptions);
  }

  function signInPage(req: Request, res: Response, status: number, notice?: AuthNotice) {
    if (req.get('HX-Request') === 'true') {
      res.setHeader('HX-Redirect', notice ? `/sign-in?notice=${notice}` : '/sign-in');
      res.status(status).end();
      return;
    }
    res.status(status).type('html').send(html(Layout({
      title: 'Sign in',
      currentAnalyst: null,
      children: SignIn({
        error: notice ? AUTH_NOTICES[notice] : status === 401 ? 'Your session has ended. Please sign in again.' : null,
        localDemo,
      }),
    })));
  }

  function redirectPage(req: Request, res: Response, location: string) {
    if (req.get('HX-Request') === 'true') {
      res.setHeader('HX-Redirect', location);
      res.status(204).end();
      return;
    }
    res.redirect(303, location);
  }

  async function context(req: Request): Promise<RequestContext> {
    const accessToken = parseCookies(req.headers.cookie)[authCookie] ?? '';
    if (!SESSION_TOKEN_PATTERN.test(accessToken)) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Your session has ended. Please sign in again.');
    }
    const analyst = await api.me(accessToken);
    const analysts = await api.analysts(accessToken);
    return { analysts, analyst, accessToken, isHx: req.get('HX-Request') === 'true' };
  }

  function matchesExpectedIdentity(req: Request, res: Response, analyst: AuthenticatedAnalyst): boolean {
    const body = req.body as Record<string, unknown>;
    if (body.expectedAnalystId === undefined || body.expectedAnalystId === analyst.id) return true;
    if (req.get('HX-Request') === 'true') {
      res.setHeader('HX-Redirect', '/');
    }
    res.status(409).type('html').send(html(Layout({
      title: 'Session changed',
      currentAnalyst: analyst,
      children: ErrorPanel({
        heading: 'Your signed-in user changed',
        message: 'Reload the page and review it as the current user before submitting again.',
      }),
    })));
    return false;
  }

  function page(
    res: Response,
    ctx: RequestContext,
    title: string,
    body: ReactElement,
    opts: { status?: number; toast?: string | undefined } = {},
  ): void {
    res
      .status(opts.status ?? 200)
      .type('html')
      .send(
        html(
          Layout({
            title,
            currentAnalyst: ctx.analyst,
            toast: opts.toast,
            children: body,
          }),
        ),
      );
  }

  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const staticDir = publicDir ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
  app.use(express.static(staticDir, { index: false, cacheControl: false }));
  app.use((req, res, next) => {
    if (parseCookies(req.headers.cookie).analyst_id !== undefined) {
      res.clearCookie('analyst_id', cookieOptions);
    }
    if (parseCookies(req.headers.cookie).kyc_access_token !== undefined) {
      res.clearCookie('kyc_access_token', cookieOptions);
    }
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    try {
      const protocol = cookieOptions.secure ? 'https' : req.protocol;
      const origin = new URL(`${protocol}://${req.get('host')}`).origin;
      if (req.get('Origin') === origin && req.get('Sec-Fetch-Site') !== 'cross-site') return next();
    } catch {
      // Invalid hosts cannot establish a same-origin request.
    }
    res.status(403).type('text').send('A same-origin form submission is required.');
  });
  app.use(express.urlencoded({ extended: false }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/sign-in', (req, res) => {
    const notice = req.query.notice;
    signInPage(req, res, 200,
      typeof notice === 'string' && Object.hasOwn(AUTH_NOTICES, notice) ? notice as AuthNotice : undefined);
  });

  app.post('/sign-in', async (req, res) => {
    clearCredential(res);
    try {
      const body = req.body as Record<string, unknown>;
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          password.length === 0 || password.length > 256) {
        signInPage(req, res, 400, 'validation');
        return;
      }
      const { session } = await api.signIn(email, password);
      res.cookie(authCookie, session.token, {
        ...cookieOptions,
        maxAge: Date.parse(session.expiresAt) - Date.now(),
      });
      redirectPage(req, res, '/');
    } catch (err) {
      if (err instanceof ApiError && [400, 401, 429].includes(err.status)) {
        const notice = err.status === 400 ? 'validation' : err.status === 401 ? 'invalid-credentials' : 'throttled';
        signInPage(req, res, err.status, notice);
        return;
      }
      signInPage(req, res, 502, 'unavailable');
    }
  });

  app.post('/sign-out', async (req, res) => {
    const accessToken = parseCookies(req.headers.cookie)[authCookie] ?? '';
    try {
      const body = req.body as Record<string, unknown>;
      if (SESSION_TOKEN_PATTERN.test(accessToken) && body.expectedAnalystId !== undefined) {
        const analyst = await api.me(accessToken).catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 401) return null;
          throw err;
        });
        if (analyst && !matchesExpectedIdentity(req, res, analyst)) return;
      }
      clearCredential(res);
      if (SESSION_TOKEN_PATTERN.test(accessToken)) {
        await api.signOut(accessToken);
      }
      redirectPage(req, res, '/sign-in');
    } catch {
      clearCredential(res);
      signInPage(req, res, 502, 'logout-failed');
    }
  });

  app.get('/', async (req, res, next) => {
    try {
      const ctx = await context(req);
      const filters = parseFilters(req.query as Record<string, unknown>);
      if (ctx.isHx) {
        const result = await api.listCases(filters, ctx.accessToken);
        res.setHeader('HX-Push-Url', queueUrl(filters));
        res.type('html').send(fragment(QueueResults({ filters, result, analysts: ctx.analysts })));
        return;
      }
      const [stats, result] = await Promise.all([
        api.stats(ctx.accessToken), api.listCases(filters, ctx.accessToken),
      ]);
      page(res, ctx, 'Case queue', QueuePage({ filters, stats, result, analysts: ctx.analysts }));
    } catch (err) {
      next(err);
    }
  });

  async function loadCaseView(id: string, accessToken: string) {
    const [kase, explanation] = await Promise.all([
      api.getCase(id, accessToken),
      api.riskExplanation(id, accessToken).catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) throw err;
        return null;
      }),
    ]);
    return { kase, explanation, chain: verifyChain(kase.audit) };
  }

  function caseTitle(kase: CaseDetail): string {
    return `${kase.reference} · ${kase.customer.fullName}`;
  }

  app.get('/cases/:id', async (req, res, next) => {
    const id = req.params.id;
    try {
      const ctx = await context(req);
      const view = await loadCaseView(id, ctx.accessToken);
      const done = typeof req.query.done === 'string' && isCaseAction(req.query.done) ? req.query.done : null;
      page(res, ctx, caseTitle(view.kase), CaseMain({ ...view, analysts: ctx.analysts }), {
        toast: done ? DONE_MESSAGES[done] : undefined,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        const ctx = await context(req).catch((contextError: unknown) => {
          next(contextError);
          return null;
        });
        if (ctx) {
          page(res, ctx, 'Case not found', NotFoundCase({ id }), { status: 404 });
        }
        return;
      }
      next(err);
    }
  });

  app.get('/cases/:id/actions/:action', async (req, res, next) => {
    const { id, action } = req.params;
    try {
      const ctx = await context(req);
      if (!isCaseAction(action)) {
        res.status(404).type('text').send('Unknown action');
        return;
      }
      if (ctx.isHx) {
        const kase = await api.getCase(id, ctx.accessToken);
        res.type('html').send(fragment(ActionDialog({ kase, action, note: '', error: null, expectedAnalystId: ctx.analyst.id })));
        return;
      }
      const view = await loadCaseView(id, ctx.accessToken);
      const body = [
        CaseMain({ ...view, analysts: ctx.analysts }),
        ActionDialog({ kase: view.kase, action, note: '', error: null, expectedAnalystId: ctx.analyst.id }),
      ];
      page(res, ctx, `${ACTION_LABELS[action]} ${view.kase.reference}`, createFragmentList(body));
    } catch (err) {
      next(err);
    }
  });

  app.post('/cases/:id/actions/:action', async (req, res, next) => {
    const { id, action } = req.params;
    try {
      const ctx = await context(req);
      if (!matchesExpectedIdentity(req, res, ctx.analyst)) return;
      if (!isCaseAction(action)) {
        res.status(404).type('text').send('Unknown action');
        return;
      }
      const body = req.body as Record<string, unknown>;
      const rawNote = typeof body.note === 'string' ? body.note : '';
      const kase = await api.getCase(id, ctx.accessToken);

      const respondError = (message: string, status: number) => {
        const dialog = ActionDialog({ kase, action, note: rawNote, error: message, expectedAnalystId: ctx.analyst.id });
        if (ctx.isHx) {
          res.setHeader('HX-Retarget', '#dialog-slot');
          res.setHeader('HX-Reswap', 'innerHTML');
          res.type('html').send(fragment(dialog));
          return;
        }
        void loadCaseView(id, ctx.accessToken)
          .then((view) =>
            page(
              res,
              ctx,
              `${ACTION_LABELS[action]} ${kase.reference}`,
              createFragmentList([CaseMain({ ...view, analysts: ctx.analysts }), dialog]),
              { status },
            ),
          )
          .catch(next);
      };

      const clientError = validateNote(action, kase.riskLevel, rawNote, kase.approvalNoteRequired);
      if (clientError) {
        respondError(clientError, 400);
        return;
      }

      try {
        await api.performAction(id, ctx.accessToken, action, normaliseNote(rawNote), ctx.analyst.id);
      } catch (err) {
        if (err instanceof ApiError && [400, 403, 409].includes(err.status)) {
          respondError(err.message, err.status);
          return;
        }
        throw err;
      }

      if (ctx.isHx) {
        const view = await loadCaseView(id, ctx.accessToken);
        res.type('html').send(
          fragment(
            createFragmentList([
              CaseMain({ ...view, analysts: ctx.analysts }),
              // Out-of-band swaps: close the dialog and show the toast.
              <div id="dialog-slot" hx-swap-oob="true" />,
              <div id="toast" hx-swap-oob="true" className="toast" role="status" aria-live="polite">
                {DONE_MESSAGES[action]}
              </div>,
            ]),
          ),
        );
        return;
      }
      res.redirect(303, `/cases/${encodeURIComponent(id)}?done=${action}`);
    } catch (err) {
      next(err);
    }
  });

  app.use(async (req, res, next) => {
    try {
      const ctx = await context(req);
      page(res, ctx, 'Not found', ErrorPanel({ heading: 'Page not found', message: 'This page does not exist.' }), {
        status: 404,
      });
    } catch (err) {
      next(err);
    }
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError && err.status === 401) {
      clearCredential(res);
      signInPage(req, res, 401);
      return;
    }
    const unreachable = err instanceof ApiUnreachableError;
    const status = unreachable ? 502 : err instanceof ApiError ? err.status : 500;
    const heading = unreachable ? 'The KYC API is unreachable' : 'Something went wrong';
    const message = unreachable
      ? 'The web console could not reach the case API. Check that the backend is running on port 4000 and try again.'
      : 'The request could not be completed. Please try again.';
    res.status(status).type('html').send(html(Layout({
      title: heading, currentAnalyst: null, children: ErrorPanel({ heading, message }),
    })));
  });

  return app;
}

function createFragmentList(children: ReactElement[]): ReactElement {
  return createElement(Fragment, null, ...children);
}
