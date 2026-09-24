import { createHash, timingSafeEqual } from 'node:crypto';

// Constant-time comparison. Hashing first gives equal-length buffers, so neither the secret
// nor its length leaks through timing.
export function secretEquals(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

export function bearerMatches(authorization: string | null, expected: string): boolean {
  if (!authorization?.startsWith('Bearer ')) return false;
  return secretEquals(authorization.slice('Bearer '.length), expected);
}
