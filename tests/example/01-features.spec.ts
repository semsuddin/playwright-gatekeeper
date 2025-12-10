/**
 * Example Feature Tests
 *
 * These tests depend on gatekeepers passing before they run.
 * Each test waits for its specific gatekeepers to complete before proceeding.
 */

import { trackedTest as test, expect, dependsOn } from '../../src/orchestration';

test.describe('Dashboard Features', () => {
  test('Dashboard loads correctly', async ({ page }) => {
    await dependsOn('auth');

    await page.goto('https://example.com');
    await expect(page).toHaveTitle(/Example Domain/);
  });

  test('User profile displays', async ({ page }) => {
    await dependsOn('auth', 'api');

    await page.goto('https://example.com');
    await expect(page.locator('body')).toBeVisible();
  });

  test('Dashboard metrics load', async ({ page }) => {
    await dependsOn('auth', 'db');

    await page.goto('https://example.com');
    await expect(page.locator('h1')).toContainText('Example');
  });
});

test.describe('Settings Features', () => {
  test('Settings page loads', async ({ page }) => {
    await dependsOn('auth');

    await page.goto('https://example.com');
    await expect(page).toHaveURL(/example\.com/);
  });

  test('Can update user preferences', async ({ page }) => {
    await dependsOn('auth', 'db');

    await page.goto('https://example.com');
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Admin Features', () => {
  test('Admin panel access', async ({ page }) => {
    await dependsOn('auth', 'api', 'db');

    await page.goto('https://example.com');
    await expect(page).toHaveTitle(/Example/);
  });
});

// This test will wait for 'will-fail' to complete, then skip because it failed
test.describe('Chain Dependency Example', () => {
  test('Test depending on failing gatekeeper', async ({ page }) => {
    await dependsOn('will-fail');
    await page.goto('https://example.com');
  });
});
