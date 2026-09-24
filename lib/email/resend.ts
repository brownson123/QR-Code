import type { EmailProvider } from './provider';
import { ProviderError } from './provider';

// Resend over plain fetch (SPEC §17 A1, verified: Idempotency-Key header, inline `content_id`).
// Open/click tracking is a per-domain setting in Resend and MUST be off (SPEC §12).
export function createResendProvider(opts: { apiKey: string; fetchImpl?: typeof fetch }): EmailProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    name: 'resend',
    async send(m) {
      const res = await doFetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': m.idempotencyKey,
        },
        body: JSON.stringify({
          from: m.from,
          to: [m.to],
          subject: m.subject,
          html: m.html,
          text: m.text,
          attachments: m.inlineImages.map((i) => ({
            filename: i.filename,
            content: i.content.toString('base64'),
            content_type: i.contentType,
            content_id: i.cid,
          })),
        }),
      });
      if (!res.ok) {
        const retryAfter = Number(res.headers.get('retry-after'));
        // The response body may echo the recipient; never put it in the error.
        throw new ProviderError(`Resend responded ${res.status}`, res.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
      }
      const body: unknown = await res.json();
      const id = typeof body === 'object' && body !== null && 'id' in body && typeof body.id === 'string' ? body.id : '';
      if (!id) throw new ProviderError('Resend response had no id', 502);
      return { id };
    },
  };
}
