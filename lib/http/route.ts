import { randomUUID } from 'node:crypto';
import { sanitizeError } from '@/lib/domain/outbox';

type Handler<C> = (request: Request, ctx: C) => Promise<Response>;

// Maps unexpected throws to a 500 carrying a request id. Logs the id and a sanitized error only (I-11).
export function route<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (request, ctx) => {
    try {
      return await handler(request, ctx);
    } catch (err) {
      const requestId = randomUUID();
      console.error(JSON.stringify({ level: 'error', requestId, error: sanitizeError(err) }));
      return Response.json({ error: 'internal', requestId }, { status: 500 });
    }
  };
}
