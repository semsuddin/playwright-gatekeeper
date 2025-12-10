/**
 * Example Gatekeeper Tests
 *
 * These tests act as gatekeepers - critical prerequisite tests that
 * must pass before dependent tests can run meaningfully.
 *
 * Gatekeepers typically test:
 * - API health/availability
 * - Authentication flows
 * - Core infrastructure
 * - Critical user journeys
 */

import { trackedTest as test, expect, markAs } from '../../src/orchestration';

test.describe('Gatekeepers', () => {
  test('API is healthy', async ({ page }) => {
    // Mark this test as the gatekeeper for 'api' dependency
    markAs('api');

    // Example: Check if the API is responding
    // In a real scenario, you might hit an actual health endpoint
    await page.goto('https://example.com');
    await expect(page).toHaveTitle(/Example Domain/);
  });

  test('Authentication works', async ({ page }) => {
    // This gatekeeper depends on 'api' being healthy first
    // If 'api' failed, this test will be skipped automatically
    markAs('auth', ['api']);

    // Example: Simulate a login flow
    // For demo purposes, we'll just verify a page loads
    await page.goto('https://example.com');
    await expect(page).toHaveTitle(/Example Domain/);
  });

  test('Database connection', async ({ page }) => {
    // Independent gatekeeper - doesn't depend on others
    markAs('db');

    // Example: Verify database connectivity
    // In reality, this might hit a DB status endpoint
    await page.goto('https://example.com');
    await expect(page.locator('body')).toBeVisible();
  });

  // Example of a failing gatekeeper - uncomment to test skip behavior
  test('Intentionally failing gatekeeper', async ({ page }) => {
    markAs('will-fail');
    await page.goto('https://example.com');
    // This assertion will fail - demonstrates dependency skipping
    await expect(page).toHaveTitle(/This Will Not Match/);
  });
});
