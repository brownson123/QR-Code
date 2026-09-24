import { randomUUID } from 'node:crypto';
import { sanitizeError } from '@/lib/domain/outbox';

type Handler = (request: Request) => Promise<Response>;

// Maps unexpected throws to a 500 carrying a request id. Logs the id and a sanitized error only (I-11).
export function route(handler: Handler): Handler {
  return async (request) => {
    try {
      return await handler(request);
    } catch (err) {
      const requestId = randomUUID();
      console.error(JSON.stringify({ level: 'error', requestId, error: sanitizeError(err) }));
      return Response.json({ error: 'internal', requestId }, { status: 500 });
    }
  };
}
