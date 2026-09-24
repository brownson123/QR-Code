import { describe, expect, it } from 'vitest';
import { sniffImage } from '@/lib/domain/image';

const bytes = (...parts: Array<number[] | string>) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...Buffer.from(p, 'latin1')] : p)));

describe('image magic bytes (SPEC F5)', () => {
  it('T-PASS-05: recognizes JPEG, PNG and WebP by content', () => {
    expect(sniffImage(bytes([0xff, 0xd8, 0xff, 0xe0], 'rest'))).toBe('jpeg');
    expect(sniffImage(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a], 'rest'))).toBe('png');
    expect(sniffImage(bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 '))).toBe('webp');
  });

  it('T-PASS-06: rejects PDF, SVG, RIFF-but-not-WebP, HEIC and short input', () => {
    expect(sniffImage(bytes('%PDF-1.7\n'))).toBeNull();
    expect(sniffImage(bytes('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImage(bytes('RIFF', [1, 2, 3, 4], 'WAVEfmt '))).toBeNull();
    expect(sniffImage(bytes([0, 0, 0, 0x18], 'ftypheic'))).toBeNull();
    expect(sniffImage(bytes([0xff, 0xd8]))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});
