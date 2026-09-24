import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Browser, type Page } from '@playwright/test';
import { latestMagicLink } from './mailpit';

export const E2E_ORIGIN = 'http://localhost:3100';

export function authStatePath(name: string): string {
  const dir = join(process.cwd(), 'tests', 'e2e', '.auth');
  mkdirSync(dir, { recursive: true });
  return join(dir, `${name}.json`);
}

// The real staff sign-in: login page → magic link from Mailpit → callback → `next`.
export async function signInViaMagicLink(page: Page, email: string, next: string): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  const started = Date.now();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText('Check your email for a sign-in link')).toBeVisible();
  await page.goto(await latestMagicLink(email, started));
  await page.waitForURL((url) => url.pathname + url.search === next);
}

// Signs in once per spec file and saves cookies for `test.use({ storageState })`.
export async function saveSignedInState(browser: Browser, email: string, file: string): Promise<void> {
  // Explicit empty state: the runner would otherwise apply the file's (not yet written) storageState.
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await signInViaMagicLink(page, email, '/');
  await context.storageState({ path: file });
  await context.close();
}

export const fakeCameraArgs = (videoFile?: string) => [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  ...(videoFile ? [`--use-file-for-fake-video-capture=${videoFile}`] : []),
];

export async function chooseCheckpoint(page: Page, name: string): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(`^\\S*\\s*${name}\\b`) }).click();
  await expect(page.getByTestId('checkpoint-banner')).toContainText(name);
}

// `next dev` compiles each route on its first request (seconds). Timing assertions are about the
// scanner, not the dev compiler, so hit the routes once first. Production has no such step.
export async function warmDevServer(slug: string): Promise<void> {
  await Promise.all([
    fetch(`${E2E_ORIGIN}/api/scan`, { method: 'POST', body: '{}' }),
    fetch(`${E2E_ORIGIN}/api/events/${slug}/checkpoints`),
    fetch(`${E2E_ORIGIN}/api/events/${slug}/participants/search?q=ab`),
    fetch(`${E2E_ORIGIN}/scan/${slug}`, { redirect: 'manual' }),
  ]);
}
