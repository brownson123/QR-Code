import { z } from 'zod';

// SPEC §9.1 request body. Client-safe: the scanner builds requests with the same schema.
export const scanRequestSchema = z
  .object({
    checkpointId: z.uuid(),
    method: z.enum(['qr', 'manual']),
    token: z.string().regex(/^[A-Za-z0-9_-]{32}$/).optional(),
    participantId: z.uuid().optional(),
    clientScanId: z.uuidv4(),
    clientScannedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine((b) => (b.method === 'qr' ? b.token !== undefined && b.participantId === undefined : b.participantId !== undefined && b.token === undefined), {
    message: 'token iff qr, participantId iff manual',
  });

export type ScanRequest = z.infer<typeof scanRequestSchema>;
