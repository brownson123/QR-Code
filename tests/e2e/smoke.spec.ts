import { expect, test } from '@playwright/test';

test('home page renders (S0 smoke)', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Passline' })).toBeVisible();
});
