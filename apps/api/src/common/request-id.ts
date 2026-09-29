import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const VALID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Request IDs (API.md): reuse a well-formed incoming X-Request-Id (e.g. from the proxy),
 * otherwise generate one; always echo it in the response for support and log correlation.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && VALID.test(incoming) ? incoming : randomUUID();
  req.headers['x-request-id'] = id;
  res.setHeader('X-Request-Id', id);
  next();
}
