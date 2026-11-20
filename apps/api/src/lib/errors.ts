import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, what);

/** Wraps async route handlers so thrown errors reach the error middleware. */
export function ah<R extends Request = Request>(fn: (req: R, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req as R, res, next).catch(next);
  };
}

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, 'Validation failed', r.error.flatten());
  return r.data;
}

export function isZodError(e: unknown): e is ZodError {
  return e instanceof ZodError;
}
