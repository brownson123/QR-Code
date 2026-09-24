import { describe, expect, it } from 'vitest';
import { passState, type PassLookup } from '@/lib/domain/pass-state';

const base: PassLookup = {
  pass: { id: 'p1', revokedAt: null, revokeReason: null },
  participant: { id: 'u1', eventId: 'e1', firstName: 'Ada', status: 'accepted', deleted: false, photoPath: null, photoUpdatedAt: null },
  event: { name: 'Hack Day', venue: 'Hall', startsAt: '2026-10-03T13:00:00Z', timezone: 'America/Toronto' },
  checkedIn: false,
};
const revoked = (reason: string): PassLookup => ({ ...base, pass: { id: 'p1', revokedAt: '2026-10-01T00:00:00Z', revokeReason: reason } });

describe('pass page state (SPEC F5)', () => {
  it('T-PASS-03: active only for an unrevoked pass of an accepted, undeleted participant', () => {
    expect(passState(base)).toBe('active');
    expect(passState(null)).toBe('not_found');
  });

  it('T-PASS-03: rotated → replaced; status_change, manual, deleted → cancelled', () => {
    expect(passState(revoked('rotated'))).toBe('replaced');
    for (const r of ['status_change', 'manual', 'deleted']) expect(passState(revoked(r))).toBe('cancelled');
  });

  it('T-PASS-03: an unrevoked pass of a withdrawn or deleted participant is cancelled (drain/withdraw race)', () => {
    expect(passState({ ...base, participant: { ...base.participant, status: 'withdrawn' } })).toBe('cancelled');
    expect(passState({ ...base, participant: { ...base.participant, deleted: true } })).toBe('cancelled');
    expect(passState({ ...revoked('rotated'), participant: { ...base.participant, status: 'withdrawn' } })).toBe('cancelled');
  });
});
