import { expect, test } from '@playwright/test';
import { authStatePath, E2E_ORIGIN, saveSignedInState } from '../fixtures/e2e';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC §11 organizer UI. Pages are gated server-side (403), and every number comes from /api/admin.
const ORG = authStatePath('admin-org');
const VOL = authStatePath('admin-vol');
const OTHER_ORG = authStatePath('admin-other-org');
const PAGES = ['', '/participants', '/checkpoints', '/staff', '/sync', '/export'];

test.describe.configure({ mode: 'serial' });
test.use({ storageState: ORG });

let f: StandardFixture;
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  f = await createStandardFixture();
  // vol3 becomes an organizer of E2 only: an organizer, but of the wrong event.
  await f.pool.query(`update event_staff set role = 'organizer' where event_id = $1 and user_id = $2`, [f.e2.id, f.staff.vol3]);
  await saveSignedInState(browser, f.staffEmail.org1, ORG);
  await saveSignedInState(browser, f.staffEmail.vol1, VOL);
  await saveSignedInState(browser, f.staffEmail.vol3, OTHER_ORG);
});
test.afterAll(async () => {
  await f.close();
});

test('T-ADM-01 (pages): a volunteer, and an organizer of another event, get 403 on every /admin page', async ({ browser }) => {
  for (const state of [VOL, OTHER_ORG]) {
    const context = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: state });
    for (const path of PAGES) {
      const res = await context.request.get(`/admin/${f.slug}${path}`, { maxRedirects: 0 });
      expect(res.status(), `${state} ${path}`).toBe(403);
      expect(await res.text()).not.toContain('Ada');
    }
    await context.close();
  }
});

test('T-ADM-01 (pages): signed out, /admin redirects to login with a way back', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto(`/admin/${f.slug}`);
  await expect(page).toHaveURL(`/login?next=${encodeURIComponent(`/admin/${f.slug}`)}`);
  await context.close();
});

test('T-ADM-01 (pages): the organizer gets 200 on every /admin page', async ({ request }) => {
  for (const path of PAGES) {
    const res = await request.get(`/admin/${f.slug}${path}`, { maxRedirects: 0 });
    expect(res.status(), path).toBe(200);
  }
});

test('T-ADM-06: door closed 20 min before starts_at shows a warning; opening the door clears it', async ({ page }) => {
  await f.pool.query(`update events set starts_at = now() + interval '20 minutes' where id = $1`, [f.e1.id]);
  await f.pool.query(`update checkpoints set is_open = false where id = $1`, [f.cp.D]);

  await page.goto(`/admin/${f.slug}`);
  const warning = page.getByRole('alert').filter({ hasText: 'door is closed' });
  await expect(warning).toBeVisible();
  await expect(page.getByTestId('kpi-accepted')).toHaveText(/Accepted\s*4/); // A, B, Rv, N (T is a test participant, §13)

  await page.goto(`/admin/${f.slug}/checkpoints`);
  const door = page.getByRole('row', { name: /Door/ });
  await expect(door.getByTestId('cp-state')).toHaveText('○ Closed');
  await door.getByRole('button', { name: 'Open Door' }).click();
  await expect(door.getByTestId('cp-state')).toHaveText('● Open');
  await expect(door.getByRole('button', { name: 'Close Door' })).toBeVisible();

  await page.goto(`/admin/${f.slug}`);
  await expect(page.getByTestId('kpi-accepted')).toBeVisible();
  await expect(warning).toHaveCount(0);
});

test('Admin smoke: walk-in with check-in shows as checked in; void a scan; exports are CSV', async ({ page }) => {
  await page.goto(`/admin/${f.slug}/participants`);
  await page.getByRole('button', { name: 'Add walk-in' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First name').fill('Wanda');
  await dialog.getByLabel('Last name').fill('Walkin');
  await dialog.getByLabel('Email', { exact: true }).fill(`wanda@${f.slug}.test`);
  await dialog.getByLabel('Check in now').check();
  await dialog.getByRole('button', { name: 'Add walk-in' }).click();

  const row = page.getByRole('row', { name: /Wanda Walkin/ });
  await expect(row).toContainText('Checked in');

  await row.getByRole('button', { name: 'Details for Wanda Walkin' }).click();
  const details = page.getByRole('region', { name: 'Wanda Walkin' });
  await expect(details).toContainText('Door');
  await details.getByRole('button', { name: 'Void Door scan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Test scan' }).click();
  await expect(details).toContainText('Voided');
  const { rows } = await f.pool.query(
    `select s.voided_at from scans s join participants p on p.id = s.participant_id where p.first_name = 'Wanda' and p.event_id = $1`,
    [f.e1.id],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].voided_at).not.toBeNull();

  await page.goto(`/admin/${f.slug}/export`);
  for (const name of ['Participants CSV', 'Scans CSV', 'Checkpoint summary CSV']) {
    const href = await page.getByRole('link', { name }).getAttribute('href');
    expect(href).toBeTruthy();
    const res = await page.request.get(href ?? '');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/csv');
  }
});

test('Admin: Sync page explains when no Sheet is linked', async ({ page }) => {
  await page.goto(`/admin/${f.slug}/sync`);
  await page.getByRole('button', { name: 'Sync now (preview)' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'No Google Sheet is linked' })).toBeVisible();
});
