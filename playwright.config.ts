import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',

  // Run tests in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Workers - use multiple for parallel execution
  workers: process.env.CI ? 1 : undefined,

  // Global setup - initializes gatekeeper state before any tests run
  globalSetup: './src/orchestration/globalSetup.ts',

  // Reporter to use
  reporter: [
    ['list'],
    ['./src/orchestration/reporter.ts'],
  ],

  // Shared settings for all the projects below
  use: {
    // Base URL to use in actions like `await page.goto('/')`
    // baseURL: 'http://127.0.0.1:3000',

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',
  },

  // Single project - orchestration handles all dependency logic
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
