import { db } from '@/lib/db/server';
import { route } from '@/lib/http/route';
import { createPhotoHandler } from '@/lib/pass/handlers';

// SPEC §9.3 / F5: multipart token + file; 10 uploads/hour per pass.
export const POST = route((request) => createPhotoHandler({ db: db() })(request));
