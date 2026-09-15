import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { Db } from '../db.js';
import { ApiError } from '../errors.js';
import { MAX_PASSWORD_LENGTH } from '../domain/password.js';
import { authenticateSession } from '../repo/sessions.js';
import { recordAuthEvent } from '../repo/authEvents.js';
import { signIn, signOut, SignInThrottle } from '../services/authService.js';

export const BEARER_PATTERN = /^Bearer ([A-Za-z0-9_-]{43})$/i;
export const MAX_SOURCE_FAILURES = 64;

const signInSchema = z.object({
  email: z.string().trim().min(3).max(254).email(),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
}).strict();

export function authRoutes(db: Db): Router {
  const router = Router();
  const throttle = new SignInThrottle();
  const sourceThrottle = new SignInThrottle(MAX_SOURCE_FAILURES);
  router.use(express.json({ limit: '2kb' }));

  router.post('/sign-in', (req: Request, res: Response, next: NextFunction) => {
    const source = req.socket.remoteAddress ?? 'local';
    if (sourceThrottle.isBlocked(source, new Date())) {
      recordAuthEvent(db, 'sign_in_throttled', { reason: 'source_limit' });
      return next(new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many sign-in attempts. Try again later.'));
    }
    const parsed = signInSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(new ApiError(400, 'VALIDATION_ERROR', 'An email address and password are required.'));
    }
    try {
      const { analyst, session } = signIn(db, throttle, parsed.data);
      return res.status(201).json({
        analyst,
        session: {
          token: session.token,
          expiresAt: session.expiresAt,
          idleTimeoutMs: session.idleTimeoutMs,
        },
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        sourceThrottle.recordFailure(source, new Date());
      }
      return next(error);
    }
  });

  router.post('/sign-out', (req: Request, res: Response) => {
    const token = BEARER_PATTERN.exec(req.header('authorization') ?? '')?.[1];
    if (token) {
      const analyst = authenticateSession(db, token);
      signOut(db, token, analyst?.id ?? null);
    }
    res.status(204).end();
  });

  return router;
}
