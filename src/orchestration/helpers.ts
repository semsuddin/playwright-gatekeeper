import { test } from '@playwright/test';
import { getGlobalState, type FailedDependencyInfo } from './testContext';

// Store the current test's gatekeeper key for auto-recording results
let currentGatekeeperKey: string | null = null;

/**
 * Mark the current test as a gatekeeper for the given key.
 * The test result will be automatically recorded when the test completes.
 *
 * @param key - Unique identifier for this gatekeeper (e.g., 'auth', 'api-health')
 * @param dependencies - Optional array of keys this gatekeeper depends on
 *
 * @example
 * test('login works', async ({ page }) => {
 *   markAs('auth');
 *   await page.goto('/login');
 *   // ... test logic
 * });
 *
 * @example
 * test('dashboard auth', async ({ page }) => {
 *   markAs('dashboard-auth', ['auth']); // depends on 'auth' gatekeeper
 *   // ... test logic
 * });
 */
export function markAs(key: string, dependencies: string[] = []): void {
  const state = getGlobalState();

  // Check if this gatekeeper's own dependencies have failed
  if (dependencies.length > 0) {
    const failed = state.getFailedDependency(dependencies);
    if (failed) {
      const chainStr = formatDependencyChain(failed.chain);
      test.skip(true, `Skipped: dependency '${failed.key}' failed${chainStr}`);
      return;
    }
  }

  // Register this test as a gatekeeper
  state.registerGatekeeper(key, dependencies);
  currentGatekeeperKey = key;
}

/**
 * Declare that the current test depends on the given gatekeeper keys.
 * The test will WAIT for its gatekeepers to complete before checking their status.
 * If any dependency (or transitive dependency) failed, the test will be skipped.
 *
 * @param keys - One or more gatekeeper keys to depend on
 * @param timeoutMs - Max time to wait for each gatekeeper (default 30s)
 *
 * @example
 * test('dashboard loads', async ({ page }) => {
 *   await dependsOn('auth');
 *   await page.goto('/dashboard');
 * });
 *
 * @example
 * test('admin panel', async ({ page }) => {
 *   await dependsOn('auth', 'api');  // Waits for both
 * });
 */
export async function dependsOn(
  ...args: [...string[]] | [...string[], number]
): Promise<void> {
  // Parse arguments - last arg might be timeout
  let keys: string[];
  let timeoutMs = 30000;

  if (args.length > 0 && typeof args[args.length - 1] === 'number') {
    timeoutMs = args.pop() as number;
    keys = args as string[];
  } else {
    keys = args as string[];
  }

  if (keys.length === 0) {
    return;
  }

  const state = getGlobalState();

  // Wait for all dependencies to have results
  const results = await state.waitForResults(keys, timeoutMs);

  // Check for any that timed out (gatekeeper never ran)
  for (const [key, result] of results) {
    if (result === undefined) {
      test.skip(true, `Skipped: dependency '${key}' did not complete within ${timeoutMs}ms (gatekeeper may not exist)`);
      return;
    }
  }

  // Now check if any failed
  const failed = state.getFailedDependency(keys);

  if (failed) {
    const chainStr = formatDependencyChain(failed.chain);
    const errorStr = failed.error ? `: ${failed.error}` : '';
    test.skip(true, `Skipped: dependency '${failed.key}' failed${errorStr}${chainStr}`);
  }
}

/**
 * Format the dependency chain for display in skip messages
 */
function formatDependencyChain(chain: string[]): string {
  if (chain.length <= 1) {
    return '';
  }
  return ` (chain: ${chain.join(' → ')})`;
}

/**
 * Get the current gatekeeper key (used internally by fixtures)
 */
export function getCurrentGatekeeperKey(): string | null {
  return currentGatekeeperKey;
}

/**
 * Clear the current gatekeeper key (used internally by fixtures)
 */
export function clearCurrentGatekeeperKey(): void {
  currentGatekeeperKey = null;
}

/**
 * Record the result for the current gatekeeper (used internally by fixtures)
 */
export function recordGatekeeperResult(passed: boolean, error?: string): void {
  if (currentGatekeeperKey) {
    const state = getGlobalState();
    state.setResult(currentGatekeeperKey, passed, error);
    currentGatekeeperKey = null;
  }
}

/**
 * Check if all given dependencies have passed without skipping
 * Useful for conditional logic within tests
 *
 * @param keys - One or more gatekeeper keys to check
 * @returns Object with pass status and failure info
 *
 * @example
 * const { passed, failedKey } = checkDependencies('auth', 'api');
 * if (!passed) {
 *   console.log(`Dependency ${failedKey} failed`);
 * }
 */
export function checkDependencies(...keys: string[]): {
  passed: boolean;
  failedKey?: string;
  failedInfo?: FailedDependencyInfo;
} {
  if (keys.length === 0) {
    return { passed: true };
  }

  const state = getGlobalState();
  const failed = state.getFailedDependency(keys);

  if (failed) {
    return {
      passed: false,
      failedKey: failed.key,
      failedInfo: failed,
    };
  }

  return { passed: true };
}
