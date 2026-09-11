import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import cors from 'cors';
import { z } from 'zod';
import type { Db } from '../db.js';
import { ApiError, notFound, unauthorized } from '../errors.js';
import { explainAssessment } from '../domain/risk.js';
import { policyPatchSchema } from '../domain/policy.js';
import { getAllowedActions, actionBodySchema } from '../domain/transitions.js';
import { getAnalyst, listAnalysts } from '../repo/analysts.js';
import { CASE_SORTS, caseStats, getCase, listCases } from '../repo/cases.js';
import { getCustomer } from '../repo/customers.js';
import { listAuditEvents } from '../repo/audit.js';
import { listSignals } from '../repo/signals.js';
import { listPolicyChanges, loadPolicy } from '../repo/policy.js';
import { applyCaseAction } from '../services/caseService.js';
import { getPolicyView, updatePolicy } from '../services/policyService.js';
import type { Analyst } from '../types.js';

declare module 'express-serve-static-core' {
  interface Request {
    analyst?: Analyst | undefined;
  }
}

const DEFAULT_ANALYST_ID = 'ana-001';

const listQuerySchema = z.object({
  status: z
    .string()
    .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean))
    .pipe(z.array(z.enum(['pending', 'in_review', 'approved', 'rejected', 'escalated'])))
    .optional(),
  riskLevel: z
    .string()
    .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean))
    .pipe(z.array(z.enum(['low', 'medium', 'high'])))
    .optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(CASE_SORTS).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  next();
}

export function createApp(db: Db): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(cors({ origin: /^https?:\/\/localhost(:\d+)?$|^https?:\/\/127\.0\.0\.1(:\d+)?$/ }));
  app.use(express.json({ limit: '50kb' }));

  const resolveAnalyst = (required: boolean) => (req: Request, _res: Response, next: NextFunction) => {
    const id = req.header('x-analyst-id');
    if (id) {
      const analyst = getAnalyst(db, id);
      if (!analyst) return next(unauthorized(`Unknown analyst id '${id}'.`));
      req.analyst = analyst;
      return next();
    }
    if (required) {
      return next(unauthorized('Missing x-analyst-id header.'));
    }
    req.analyst = getAnalyst(db, DEFAULT_ANALYST_ID) ?? undefined;
    return next();
  };

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/me', resolveAnalyst(false), (req, res, next) => {
    if (!req.analyst) return next(unauthorized('No analyst context available.'));
    res.json(req.analyst);
  });

  app.get('/api/analysts', (_req, res) => {
    res.json(listAnalysts(db));
  });

  app.get('/api/cases/stats', (_req, res) => {
    res.json(caseStats(db));
  });

  app.get('/api/cases', (req, res, next) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return next(
        new ApiError(400, 'VALIDATION_ERROR', 'Invalid query parameters.', parsed.error.issues),
      );
    }
    const { status, riskLevel, q, sort, order, page, pageSize } = parsed.data;
    const { items, total } = listCases(db, {
      ...(status ? { status } : {}),
      ...(riskLevel ? { riskLevel } : {}),
      ...(q ? { q } : {}),
      sort,
      order,
      page,
      pageSize,
    });
    res.json({ items, total, page, pageSize });
  });

  app.get('/api/cases/:id', resolveAnalyst(false), (req, res, next) => {
    const caseId = String(req.params.id);
    const kase = getCase(db, caseId);
    if (!kase) return next(notFound(`Case '${caseId}' not found.`));
    const customer = getCustomer(db, kase.customerId);
    if (!customer) return next(notFound(`Customer '${kase.customerId}' not found.`));
    const role = req.analyst?.role ?? 'analyst';
    res.json({
      ...kase,
      customer,
      signals: listSignals(db, kase.id),
      audit: listAuditEvents(db, kase.id),
      allowedActions: getAllowedActions(kase.status, role),
    });
  });

  app.get('/api/cases/:id/risk-explanation', (req, res, next) => {
    const caseId = String(req.params.id);
    const kase = getCase(db, caseId);
    if (!kase) return next(notFound(`Case '${caseId}' not found.`));
    res.json(
      explainAssessment(
        kase.id,
        kase.riskScore,
        kase.riskLevel,
        listSignals(db, kase.id),
        loadPolicy(db).thresholds,
      ),
    );
  });

  app.get('/api/policy', (_req, res) => {
    res.json(getPolicyView(db));
  });

  app.get('/api/policy/history', (_req, res) => {
    res.json(listPolicyChanges(db));
  });

  app.put('/api/policy', resolveAnalyst(true), (req, res, next) => {
    const parsed = policyPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(new ApiError(400, 'VALIDATION_ERROR', 'Invalid policy body.', parsed.error.issues));
    }
    res.json(updatePolicy(db, req.analyst as Analyst, parsed.data));
  });

  app.get('/api/cases/:id/audit', (req, res, next) => {
    const caseId = String(req.params.id);
    const kase = getCase(db, caseId);
    if (!kase) return next(notFound(`Case '${caseId}' not found.`));
    res.json(listAuditEvents(db, kase.id));
  });

  app.post('/api/cases/:id/actions', resolveAnalyst(true), (req, res, next) => {
    const parsed = actionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return next(new ApiError(400, 'VALIDATION_ERROR', 'Invalid action body.', parsed.error.issues));
    }
    const result = applyCaseAction(
      db,
      String(req.params.id),
      req.analyst as Analyst,
      parsed.data.action,
      parsed.data.note,
    );
    res.json({ ...result.case, audit: result.audit, allowedActions: result.allowedActions });
  });

  app.use((_req, _res, next) => next(notFound('Route not found.')));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      const body: { error: { code: string; message: string; details?: unknown } } = {
        error: { code: err.code, message: err.message },
      };
      if (err.details !== undefined) body.error.details = err.details;
      return res.status(err.status).json(body);
    }
    if (err instanceof SyntaxError) {
      return res
        .status(400)
        .json({ error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON body.' } });
    }
    res
      .status(500)
      .json({ error: { code: 'INTERNAL', message: 'Internal server error.' } });
  });

  return app;
}
