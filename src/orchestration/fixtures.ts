import { test as base, expect } from '@playwright/test';
import {
  getCurrentGatekeeperKey,
  clearCurrentGatekeeperKey,
  recordGatekeeperResult,
} from './helpers';

/**
 * Base test - no automatic tracking
 */
export const test = base;

// Re-export expect for convenience
export { expect };

/**
 * Extended test that auto-tracks gatekeeper results
 * Use this for all tests that use markAs() or dependsOn()
 */
export const trackedTest = base.extend<{ autoTrackGatekeeper: void }>({
  autoTrackGatekeeper: [async ({}, use, testInfo) => {
    // Before test: nothing to do
    await use();

    // After test: record gatekeeper result if marked
    const gatekeeperKey = getCurrentGatekeeperKey();
    if (gatekeeperKey) {
      const passed = testInfo.status === 'passed';
      const error = testInfo.error?.message;
      recordGatekeeperResult(passed, error);
    }
    clearCurrentGatekeeperKey();
  }, { auto: true }],
});

// Legacy export for backwards compatibility
export function setupGatekeeperTracking(): void {
  // No-op - use trackedTest instead
}
