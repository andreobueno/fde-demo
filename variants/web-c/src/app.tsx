import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { Fragment, createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiError, ApiUnreachableError } from './api/client.js';
import type { ApiClient } from './api/client.js';
import { CASE_ACTIONS } from './api/types.js';
import type { Analyst, CaseAction, CaseDetail } from './api/types.js';
import { verifyChain } from './lib/audit.js';
import { parseFilters, queueUrl } from './lib/filters.js';
import { ACTION_LABELS, normaliseNote, validateNote } from './lib/validation.js';
import { ActionDialog, CaseMain, NotFoundCase } from './views/CasePage.js';
import { ErrorPanel, Layout } from './views/Layout.js';
import { QueuePage, QueueResults } from './views/QueuePage.js';

export const DEFAULT_ANALYST_ID = 'ana-003';
const ANALYST_COOKIE = 'analyst_id';

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
  analystId: string;
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

function safeReturnTo(value: unknown): string {
  if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')) return value;
  return '/';
}

function html(element: ReactElement): string {
  return `<!doctype html>\n${renderToStaticMarkup(element)}`;
}

function fragment(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

export function createApp({ api, publicDir }: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  let lastAnalysts: Analyst[] | null = null;
  async function context(req: Request, recoverIdentity = req.method === 'GET'): Promise<RequestContext> {
    let analystId = parseCookies(req.headers.cookie)[ANALYST_COOKIE] || DEFAULT_ANALYST_ID;
    let analysts: Analyst[];
    try {
      analysts = await api.analysts(analystId);
    } catch (err) {
      if (!recoverIdentity || analystId === DEFAULT_ANALYST_ID || !(err instanceof ApiError) || err.status !== 401) {
        throw err;
      }
      analystId = DEFAULT_ANALYST_ID;
      analysts = await api.analysts(analystId);
    }
    lastAnalysts = analysts;
    return { analysts, analystId, isHx: req.get('HX-Request') === 'true' };
  }

  function page(
    res: Response,
    ctx: RequestContext,
    req: Request,
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
            analysts: ctx.analysts,
            currentAnalystId: ctx.analystId,
            returnTo: req.originalUrl,
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
  app.use(express.urlencoded({ extended: false }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/switch-analyst', async (req, res, next) => {
    try {
      const { analysts } = await context(req, true);
      const body = req.body as Record<string, unknown>;
      const requested = typeof body.analystId === 'string' ? body.analystId : '';
      if (!analysts.some((a) => a.id === requested)) {
        res.status(400).type('text').send('Unknown analyst');
        return;
      }
      res.cookie(ANALYST_COOKIE, requested, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
      if (req.get('HX-Request') === 'true') {
        res.setHeader('HX-Refresh', 'true');
        res.status(204).end();
        return;
      }
      res.redirect(303, safeReturnTo(body.returnTo));
    } catch (err) {
      next(err);
    }
  });

  app.get('/', async (req, res, next) => {
    try {
      const ctx = await context(req);
      const filters = parseFilters(req.query as Record<string, unknown>);
      if (ctx.isHx) {
        const result = await api.listCases(filters, ctx.analystId);
        res.setHeader('HX-Push-Url', queueUrl(filters));
        res.type('html').send(fragment(QueueResults({ filters, result, analysts: ctx.analysts })));
        return;
      }
      const [stats, result] = await Promise.all([
        api.stats(ctx.analystId), api.listCases(filters, ctx.analystId),
      ]);
      page(res, ctx, req, 'Case queue', QueuePage({ filters, stats, result, analysts: ctx.analysts }));
    } catch (err) {
      next(err);
    }
  });

  async function loadCaseView(id: string, analystId: string) {
    const [kase, explanation] = await Promise.all([
      api.getCase(id, analystId),
      api.riskExplanation(id, analystId).catch(() => null),
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
      const view = await loadCaseView(id, ctx.analystId);
      const done = typeof req.query.done === 'string' && isCaseAction(req.query.done) ? req.query.done : null;
      page(res, ctx, req, caseTitle(view.kase), CaseMain({ ...view, analysts: ctx.analysts }), {
        toast: done ? DONE_MESSAGES[done] : undefined,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        const ctx = await context(req).catch(() => null);
        if (ctx) {
          page(res, ctx, req, 'Case not found', NotFoundCase({ id }), { status: 404 });
          return;
        }
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
        const kase = await api.getCase(id, ctx.analystId);
        res.type('html').send(fragment(ActionDialog({ kase, action, note: '', error: null })));
        return;
      }
      const view = await loadCaseView(id, ctx.analystId);
      const body = [
        CaseMain({ ...view, analysts: ctx.analysts }),
        ActionDialog({ kase: view.kase, action, note: '', error: null }),
      ];
      page(res, ctx, req, `${ACTION_LABELS[action]} ${view.kase.reference}`, createFragmentList(body));
    } catch (err) {
      next(err);
    }
  });

  app.post('/cases/:id/actions/:action', async (req, res, next) => {
    const { id, action } = req.params;
    try {
      const ctx = await context(req);
      if (!isCaseAction(action)) {
        res.status(404).type('text').send('Unknown action');
        return;
      }
      const body = req.body as Record<string, unknown>;
      const rawNote = typeof body.note === 'string' ? body.note : '';
      const kase = await api.getCase(id, ctx.analystId);

      const respondError = (message: string, status: number) => {
        const dialog = ActionDialog({ kase, action, note: rawNote, error: message });
        if (ctx.isHx) {
          res.setHeader('HX-Retarget', '#dialog-slot');
          res.setHeader('HX-Reswap', 'innerHTML');
          res.type('html').send(fragment(dialog));
          return;
        }
        void loadCaseView(id, ctx.analystId)
          .then((view) =>
            page(
              res,
              ctx,
              req,
              `${ACTION_LABELS[action]} ${kase.reference}`,
              createFragmentList([CaseMain({ ...view, analysts: ctx.analysts }), dialog]),
              { status },
            ),
          )
          .catch(next);
      };

      const clientError = validateNote(action, kase.riskLevel, rawNote);
      if (clientError) {
        respondError(clientError, 400);
        return;
      }

      try {
        await api.performAction(id, ctx.analystId, action, normaliseNote(rawNote));
      } catch (err) {
        if (err instanceof ApiError && [400, 401, 403, 409].includes(err.status)) {
          respondError(err.message, err.status);
          return;
        }
        throw err;
      }

      if (ctx.isHx) {
        const view = await loadCaseView(id, ctx.analystId);
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
      page(res, ctx, req, 'Not found', ErrorPanel({ heading: 'Page not found', message: `No page at ${req.path}.` }), {
        status: 404,
      });
    } catch (err) {
      next(err);
    }
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const unreachable = err instanceof ApiUnreachableError;
    const status = unreachable ? 502 : err instanceof ApiError ? err.status : 500;
    const heading = unreachable ? 'The KYC API is unreachable' : 'Something went wrong';
    const message = unreachable
      ? 'The web console could not reach the case API. Check that the backend is running on port 4000 and try again.'
      : err instanceof Error
        ? err.message
        : 'Unexpected error.';
    if (!unreachable) console.error(err);
    const analysts = lastAnalysts ?? [{ id: DEFAULT_ANALYST_ID, name: 'Default analyst', role: 'analyst' }];
    const ctx: RequestContext = {
      analysts,
      analystId: parseCookies(req.headers.cookie)[ANALYST_COOKIE] ?? DEFAULT_ANALYST_ID,
      isHx: false,
    };
    page(res, ctx, req, heading, ErrorPanel({ heading, message }), { status });
  });

  return app;
}

function createFragmentList(children: ReactElement[]): ReactElement {
  return createElement(Fragment, null, ...children);
}
