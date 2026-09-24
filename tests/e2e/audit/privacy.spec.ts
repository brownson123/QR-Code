import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createPool } from '../../fixtures/db';

// Runs after the whole e2e suite (project "audit" depends on "chromium").
const started = readFileSync('.e2e/run-started', 'utf8').trim();
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const TOKENISH = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32}(?![A-Za-z0-9_-])/g; // §6.1 token shape

async function participantsFromThisRun(): Promise<Array<{ name: string; email: string }>> {
  const pool = createPool(1);
  try {
    const { rows } = await pool.query<{ first_name: string; last_name: string; email: string }>(
      `select first_name, last_name, email from participants where created_at >= $1 and deleted_at is null`,
      [started],
    );
    return rows.map((r) => ({ name: `${r.first_name} ${r.last_name}`.trim(), email: r.email }));
  } finally {
    await pool.end();
  }
}

test('T-SEC-05: server logs from the full e2e run contain no token, email or participant name', async () => {
  const log = readFileSync('.e2e/server.log', 'utf8');
  expect(log.length, 'the dev server wrote nothing; is the log wired up?').toBeGreaterThan(0);
  const people = await participantsFromThisRun();
  expect(people.length, 'the e2e run created no participants to look for').toBeGreaterThan(5);

  expect(log.match(EMAIL) ?? []).toEqual([]);
  expect(log.match(TOKENISH) ?? []).toEqual([]);
  expect(log).not.toContain('/p#');
  const leaked = people.filter((p) => log.includes(p.name) || log.includes(p.email)).map((p) => p.name);
  expect(leaked).toEqual([]);
});

test('T-PRIV-03: audit_log.detail written during the e2e run contains no email, name or token', async () => {
  const pool = createPool(1);
  try {
    const { rows } = await pool.query<{ action: string; detail: string }>(`select action, detail::text as detail from audit_log where created_at >= $1`, [started]);
    expect(rows.length, 'the e2e run wrote no audit rows to inspect').toBeGreaterThan(0);
    const people = await participantsFromThisRun();
    const bad = rows.filter(
      (r) => (r.detail.match(EMAIL) ?? []).length > 0 || (r.detail.match(TOKENISH) ?? []).length > 0 || people.some((p) => r.detail.includes(p.name) || r.detail.includes(p.email)),
    );
    expect(bad).toEqual([]);
  } finally {
    await pool.end();
  }
});
