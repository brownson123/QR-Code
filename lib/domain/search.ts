import { toSearchText } from './normalize';

// SPEC §10.4: at least 2 normalized characters. Decision (S5a): a single CJK/Hangul character is
// allowed, because one such character is a whole syllable or name part (resolves T-SRCH-02 vs -03).
const SINGLE_OK = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u;

export function searchQuery(raw: string): string | null {
  const q = [...toSearchText(raw)].slice(0, 100).join('');
  const length = [...q].length;
  if (length >= 2 || (length === 1 && SINGLE_OK.test(q))) return q;
  return null;
}
