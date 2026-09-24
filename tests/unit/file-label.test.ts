import { describe, expect, it } from 'vitest';
import { toFileLabel } from '@/lib/domain/file-label';

describe('toFileLabel (dev QR image names)', () => {
  it('T-MAIL-14: joins event name and first name with dashes', () => {
    expect(toFileLabel('Demo Hack Day', 'Ada')).toBe('Demo-Hack-Day-Ada');
    expect(toFileLabel('Test Event', 'Brownson')).toBe('Test-Event-Brownson');
  });

  it('T-MAIL-14: strips accents and punctuation', () => {
    expect(toFileLabel('Café Night', 'Zoë')).toBe('Cafe-Night-Zoe');
    expect(toFileLabel('HackDay 2026!', "D'Arcy")).toBe('HackDay-2026-D-Arcy');
    expect(toFileLabel('  Spaced   Out  ', ' Sofía ')).toBe('Spaced-Out-Sofia');
  });

  it('T-MAIL-14: can never produce a path', () => {
    expect(toFileLabel('../../etc', 'passwd')).toBe('etc-passwd');
    expect(toFileLabel('a/b\\c', '.hidden')).toBe('a-b-c-hidden');
    expect(toFileLabel('Event', '...')).toBe('Event');
  });

  it('T-MAIL-14: falls back to "pass" when nothing usable is left', () => {
    expect(toFileLabel('', '')).toBe('pass');
    expect(toFileLabel('李雷')).toBe('pass');
    expect(toFileLabel()).toBe('pass');
  });

  it('T-MAIL-14: is capped at 80 characters without a trailing dash', () => {
    const label = toFileLabel('x'.repeat(79), 'Ada');
    expect(label.length).toBeLessThanOrEqual(80);
    expect(label.endsWith('-')).toBe(false);
  });

  it('T-MAIL-14: is idempotent', () => {
    const once = toFileLabel('Demo Hack Day', 'Zoë');
    expect(toFileLabel(once)).toBe(once);
  });
});
