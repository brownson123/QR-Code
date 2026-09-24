import { describe, expect, it } from 'vitest';
import { safeNextPath } from '@/lib/auth/next-path';

describe('post-login redirect target', () => {
  it('T-SCUI-10: keeps same-site paths (back to the same slug) and rejects open redirects', () => {
    expect(safeNextPath('/scan/demo')).toBe('/scan/demo');
    expect(safeNextPath('/scan/demo?x=1')).toBe('/scan/demo?x=1');
    for (const bad of ['https://evil.test', '//evil.test', '/\\evil.test', 'scan/demo', '', null, undefined]) {
      expect(safeNextPath(bad)).toBe('/');
    }
  });
});
