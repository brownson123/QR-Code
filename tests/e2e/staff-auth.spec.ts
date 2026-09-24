import { expect, test } from '@playwright/test';
import { latestMagicLink } from '../fixtures/mailpit';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
test.beforeEach(async () => {
  f = await createStandardFixture();
});
test.afterEach(async () => {
  await f.close();
});

test('F9: magic-link sign-in consumes the invite, asks for a display name, then returns to next', async ({ page }) => {
  const email = `invitee-${f.slug}@example.test`;
  await f.pool.query(`insert into staff_invites (event_id, email, role) values ($1, $2, 'organizer')`, [f.e1.id, email]);
  const target = `/api/events/${f.slug}/checkpoints`;

  await page.goto(`/login?next=${encodeURIComponent(target)}`);
  const started = Date.now();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText('Check your email for a sign-in link')).toBeVisible();

  await page.goto(await latestMagicLink(email, started));
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel('Display name').fill('Maya');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page).toHaveURL(new RegExp(`${target}$`));
  const body = JSON.parse((await page.locator('body').textContent()) ?? '{}') as { role: string; checkpoints: unknown[] };
  expect(body.role).toBe('organizer');
  expect(body.checkpoints).toHaveLength(4);
  const { rows } = await f.pool.query('select 1 from staff_invites where email = $1', [email]);
  expect(rows).toHaveLength(0);
});

test('T-SCUI-10 (redirect half): a signed-out visit to /scan/<slug> goes to /login and remembers the way back', async ({ page }) => {
  await page.goto(`/scan/${f.slug}`);
  await expect(page).toHaveURL(`/login?next=${encodeURIComponent(`/scan/${f.slug}`)}`);
  await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();
});

test('F9: a broken or reused sign-in link shows an error on the login page', async ({ page }) => {
  await page.goto('/auth/callback?code=not-a-real-code&next=/scan/x');
  await expect(page).toHaveURL(/\/login\?error=link/);
  await expect(page.getByText("That sign-in link didn't work or has expired")).toBeVisible();
});
