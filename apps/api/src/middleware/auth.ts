import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

export function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization;

  if (!header) {
    // Stub: allow unauthenticated requests for hackathon
    req.userId = 'anon';
    next();
    return;
  }

  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  const secret = process.env.JWT_SECRET ?? 'changeme';

  try {
    const payload = jwt.verify(token, secret) as { sub?: string; userId?: string };
    req.userId = payload.sub ?? payload.userId ?? 'anon';
    next();
  } catch {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
  }
}
