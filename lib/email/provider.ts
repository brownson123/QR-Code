export interface InlineImage {
  cid: string;
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  inlineImages: InlineImage[];
  idempotencyKey: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<{ id: string }>;
}

// Thrown by providers for delivery failures. `message` must never contain recipient data.
export class ProviderError extends Error {
  override readonly name = 'ProviderError';
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}
