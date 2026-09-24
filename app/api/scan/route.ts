import { cookieAuthenticator } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { route } from '@/lib/http/route';
import { createScanHandler } from '@/lib/scan/handlers';

export const POST = route((request) => createScanHandler({ db: db(), authenticate: cookieAuthenticator })(request));
