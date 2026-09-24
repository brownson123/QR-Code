// I-12: every entry point normalizes through these. Never inline them.

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// SPEC §10.4: NFKD, strip combining marks, lowercase, non-alphanumerics → space, collapse, trim.
// A final NFC recomposes scripts that NFKD splits without marks (Hangul syllables → jamo).
export function toSearchText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
