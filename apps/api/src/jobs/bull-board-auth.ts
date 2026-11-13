import type { NextFunction, Request, Response } from 'express';

export interface BullBoardAuthDeps {
  /** Verifies the access token and returns its payload; throws when invalid or expired. */
  verify(token: string): { sub: string; tenantSlug?: string };
  isSysadmin(userId: string, tenantSlug?: string): Promise<boolean>;
}

/**
 * BullBoard is mounted as plain Express middleware, outside Nest's guards, so it
 * checks the session itself: the same HttpOnly `token` cookie, SYSADMIN only.
 */
export function bullBoardAuth(deps: BullBoardAuthDeps) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token: string | undefined = req.cookies?.token;
    if (!token) {
      res.status(401).json({ statusCode: 401, message: 'Unauthorized' });
      return;
    }

    let allowed: boolean;
    try {
      const payload = deps.verify(token);
      allowed = await deps.isSysadmin(payload.sub, payload.tenantSlug);
    } catch {
      res.status(401).json({ statusCode: 401, message: 'Unauthorized' });
      return;
    }

    if (!allowed) {
      res.status(403).json({ statusCode: 403, message: 'Forbidden' });
      return;
    }
    next();
  };
}
