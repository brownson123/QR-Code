import { randomUUID } from 'node:crypto';
import { createCheckpointsHandler, createScanHandler, createSearchHandler, createVoidHandler } from '@/lib/scan/handlers';
import { serviceClient } from './mail';
import { asBearer, bearerAuth } from './staff';

export function scanApi() {
  const db = serviceClient();
  const deps = { db, authenticate: bearerAuth };
  const scanH = createScanHandler(deps);
  const searchH = createSearchHandler(deps);
  const voidH = createVoidHandler(deps);
  const checkpointsH = createCheckpointsHandler(deps);

  const jsonOf = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

  return {
    db,
    async scan(jwt: string | null, body: Record<string, unknown>) {
      const full = { clientScanId: randomUUID(), clientScannedAt: new Date().toISOString(), ...body };
      return jsonOf(
        await scanH(
          new Request('http://localhost/api/scan', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...asBearer(jwt) },
            body: JSON.stringify(full),
          }),
        ),
      );
    },
    async search(jwt: string | null, slug: string, q: string, checkpointId?: string) {
      const url = new URL(`http://localhost/api/events/${slug}/participants/search`);
      url.searchParams.set('q', q);
      if (checkpointId) url.searchParams.set('checkpointId', checkpointId);
      return jsonOf(await searchH(new Request(url, { headers: asBearer(jwt) }), { slug }));
    },
    async checkpoints(jwt: string | null, slug: string) {
      return jsonOf(await checkpointsH(new Request(`http://localhost/api/events/${slug}/checkpoints`, { headers: asBearer(jwt) }), { slug }));
    },
    async voidScan(jwt: string | null, id: string, body: unknown) {
      return jsonOf(
        await voidH(
          new Request(`http://localhost/api/scans/${id}/void`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...asBearer(jwt) },
            body: JSON.stringify(body),
          }),
          { id },
        ),
      );
    },
  };
}
