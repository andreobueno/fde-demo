import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { Db } from '../db.js';
import { ApiError } from '../errors.js';
import { MAX_PASSWORD_LENGTH } from '../domain/password.js';
import { authenticateSession } from '../repo/sessions.js';
import { signIn, signOut, SignInThrottle } from '../services/authService.js';

export const BEARER_PATTERN = /^Bearer ([A-Za-z0-9_-]{43})$/i;

const signInSchema = z.object({
  email: z.string().trim().min(3).max(254).email(),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

export function authRoutes(db: Db): Router {
  const router = Router();
  const throttle = new SignInThrottle();
  router.use(express.json({ limit: '2kb' }));

  router.post('/sign-in', (req: Request, res: Response, next: NextFunction) => {
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
