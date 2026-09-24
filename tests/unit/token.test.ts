import { describe, expect, it } from 'vitest';
import { generateToken, sha256hex } from '@/lib/domain/token';

describe('tokens', () => {
  it('T-TOK-01: 10,000 generated tokens are unique, 32 chars, url-safe', () => {
    const tokens = Array.from({ length: 10_000 }, () => generateToken());
    expect(new Set(tokens).size).toBe(10_000);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('T-TOK-06: sha256hex matches the known "abc" vector', () => {
    expect(sha256hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
