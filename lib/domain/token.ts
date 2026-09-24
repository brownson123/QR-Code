import { createHash, randomBytes } from 'node:crypto';

// SPEC §6.1: 24 random bytes → 32 base64url chars, 192 bits of entropy.
export function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

// Lowercase hex sha256; the only form of a token that is ever stored (I-3).
export function sha256hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
