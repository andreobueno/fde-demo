import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Db } from '../db.js';
import type { Permission } from '../domain/authorization.js';
import { ApiError, notFound, unauthorized } from '../errors.js';
import {
  REFUND_AMOUNT_BANDS, REFUND_SORTS, REFUND_STATUSES, refundActionBodySchema,
} from '../domain/refunds.js';
import { getRefund, listRefunds, refundStats } from '../repo/refunds.js';
import { listRefundAuditEvents } from '../repo/audit.js';
import { applyRefundAction, refundDetail } from '../services/refundService.js';

const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.string().transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean))
    .pipe(z.array(z.enum(REFUND_STATUSES))).optional(),
  riskLevel: z.string().transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean))
    .pipe(z.array(z.enum(['low', 'medium', 'high']))).optional(),
  amountBand: z.enum(REFUND_AMOUNT_BANDS).default('all'),
  sort: z.enum(REFUND_SORTS).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER / 100).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export function refundRoutes(db: Db, requirePermission: (permission: Permission) => RequestHandler): Router {
  const router = Router();
  router.use(requirePermission('refunds:read'));
  router.get('/stats', (_req, res) => res.json(refundStats(db)));
  router.get('/', (req, res, next) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return next(new ApiError(400, 'VALIDATION_ERROR', 'Invalid query parameters.', parsed.error.issues));
    }
    const { items, total } = listRefunds(db, parsed.data);
    res.json({ items, total, page: parsed.data.page, pageSize: parsed.data.pageSize });
  });
  router.get('/:id', requirePermission('audit:read'), (req, res, next) => {
    if (!req.analyst) return next(unauthorized('No analyst context available.'));
    const id = String(req.params.id);
    const refund = getRefund(db, id);
    if (!refund) return next(notFound(`Refund '${id}' not found.`));
    res.json(refundDetail(db, refund, req.analyst));
  });
  router.get('/:id/audit', requirePermission('audit:read'), (req, res, next) => {
    const id = String(req.params.id);
    if (!getRefund(db, id)) return next(notFound(`Refund '${id}' not found.`));
    res.json(listRefundAuditEvents(db, id));
  });
  router.post('/:id/actions', requirePermission('audit:read'), (req, res, next) => {
    if (!req.analyst) return next(unauthorized('No analyst context available.'));
    const parsed = refundActionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return next(new ApiError(400, 'VALIDATION_ERROR', 'Invalid refund action body.', parsed.error.issues));
    }
    res.json(applyRefundAction(db, String(req.params.id), req.analyst, parsed.data.action, parsed.data.note));
  });
  return router;
}
