/**
 * Playwright Gatekeeper - Dependency-Aware Test Orchestration
 *
 * A lightweight orchestration layer that allows tests to declare dependencies
 * on "gatekeeper" tests, automatically skipping dependent tests when
 * prerequisites fail.
 *
 * @example
 * ```typescript
 * import { test, expect, markAs, dependsOn } from 'playwright-gatekeeper';
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
 *   await dependsOn('auth');
 *   await page.goto('/dashboard');
 *   // ... test assertions
 * });
 * ```
 *
 * @packageDocumentation
 */

// Core test fixtures - use `test` for gatekeeper-aware tests
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

// Re-export default reporter and setup paths for convenience
// Users can reference these in their playwright.config.ts:
//   globalSetup: require.resolve('playwright-gatekeeper/setup')
//   reporter: [['playwright-gatekeeper/reporter']]
