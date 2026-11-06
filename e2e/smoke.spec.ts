import { expect, test } from '@playwright/test';

test('the app page loads', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('#root')).toBeAttached();
});
