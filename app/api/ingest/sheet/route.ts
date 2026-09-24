import { after } from 'next/server';
import { db } from '@/lib/db/server';
import { emailFrom, getProvider } from '@/lib/email';
import { drainUntilIdle } from '@/lib/email/drain';
import { env } from '@/lib/env';
import { route } from '@/lib/http/route';
import { createIngestHandler } from '@/lib/ingest/handler';

// SPEC §9.2: HMAC-signed Apps Script requests only (no session).
export const POST = route((request) =>
  createIngestHandler({
    db: db(),
    secret: env().SHEET_INGEST_SECRET,
    scheduleDrain: (task) => after(task),
    drain: () =>
      drainUntilIdle({ db: db(), provider: getProvider(), appOrigin: env().NEXT_PUBLIC_APP_ORIGIN, from: emailFrom() }),
  })(request),
);
