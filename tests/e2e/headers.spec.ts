import { expect, test } from '@playwright/test';

// T-SEC-06 (served half): the headers actually reach the browser on pages and API routes.
// HSTS is production-only and is covered by tests/unit/security-headers.test.ts.
for (const path of ['/', '/p', '/login', '/scan/demo', '/api/pass']) {
  test(`T-SEC-06: ${path} carries CSP, frame-ancestors 'none' and camera=(self)`, async ({ request }) => {
    const res = path.startsWith('/api') ? await request.post(path, { data: {} }) : await request.get(path, { maxRedirects: 0 });
    const h = res.headers();
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['permissions-policy']).toBe('camera=(self), microphone=(), geolocation=()');
    expect(h['x-content-type-options']).toBe('nosniff');
  });
}

test('T-SEC-06: the pass page runs under the CSP without violations', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  await page.goto('/p#AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  await expect(page.getByText('Pass not found')).toBeVisible();
  expect(violations).toEqual([]);
});
