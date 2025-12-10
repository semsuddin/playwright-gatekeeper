/**
 * Dependency-Aware Test Orchestration for Playwright
 *
 * This module provides a lightweight dependency orchestration layer that allows
 * tests to declare dependencies on "gatekeeper" tests, automatically skipping
 * dependent tests when prerequisites fail.
 *
 * @example
 * ```typescript
 * import { test, expect, markAs, dependsOn } from '../src/orchestration';
 *
 * // Gatekeeper test
 * test('login works', async ({ page }) => {
 *   markAs('auth');
 *   await page.goto('/login');
 *   // ... test assertions
 * });
 *
 * // Dependent test
 * test('dashboard loads', async ({ page }) => {
 *   dependsOn('auth');
 *   await page.goto('/dashboard');
 *   // ... test assertions
 * });
 * ```
 */

// Core test fixtures
export { test, expect, trackedTest, setupGatekeeperTracking } from './fixtures';

// Helper functions for declaring dependencies
export { markAs, dependsOn } from './helpers';

// State management (for advanced use cases)
export {
  GatekeeperState,
  getGlobalState,
  resetGlobalState,
  type GatekeeperResult,
  type StateFile,
  type FailedDependencyInfo,
} from './testContext';
