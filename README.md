# Playwright Gatekeeper

[![npm version](https://img.shields.io/npm/v/playwright-gatekeeper.svg)](https://www.npmjs.com/package/playwright-gatekeeper)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A lightweight orchestration layer that allows Playwright tests to declare dependencies on "gatekeeper" tests. When a gatekeeper fails, all dependent tests are automatically skipped with clear reporting.

## Why This Exists

In E2E testing, some tests are **prerequisites** for others:
- If login is broken, testing the dashboard is pointless
- If the API is down, all API-dependent tests will fail with confusing errors
- Running 100 tests when a core dependency is broken wastes time and creates noise

This orchestration layer solves these problems by:
1. **Preventing cascading failures** - Skip tests whose prerequisites failed
2. **Saving execution time** - Don't run tests that can't possibly pass
3. **Clear reporting** - Know exactly *why* tests were skipped

---

## Installation

```bash
npm install playwright-gatekeeper
```

The package uses `@playwright/test` as a peer dependency, so it will work with whatever Playwright version you have installed (>=1.40.0).

---

## Setup

Add the global setup and reporter to your `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  // Initialize gatekeeper state before tests run
  globalSetup: require.resolve('playwright-gatekeeper/setup'),

  // Add the dependency reporter (alongside default reporters)
  reporter: [
    ['list'],
    ['playwright-gatekeeper/reporter'],
  ],

  // Your other config...
});
```

---

## Usage

### Gatekeepers

A **gatekeeper** is a critical test that other tests depend on. Mark it with `markAs()`:

```typescript
import { test, expect, markAs } from 'playwright-gatekeeper';

test('Authentication works', async ({ page }) => {
  markAs('auth');  // Register this test as the 'auth' gatekeeper

  await page.goto('/login');
  await page.fill('#username', 'testuser');
  await page.fill('#password', 'password');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL('/dashboard');
});
```

### Dependent Tests

Use `await dependsOn()` to declare dependencies. The test will **wait** for its gatekeepers to complete, then skip if any failed:

```typescript
import { test, expect, dependsOn } from 'playwright-gatekeeper';

test('Dashboard shows user data', async ({ page }) => {
  await dependsOn('auth');  // Wait for 'auth', skip if it failed

  await page.goto('/dashboard');
  await expect(page.locator('.user-name')).toBeVisible();
});
```

### Multiple Dependencies

```typescript
test('Admin panel loads', async ({ page }) => {
  await dependsOn('auth', 'api', 'db');  // Wait for all three

  await page.goto('/admin');
});
```

### Chained Dependencies

Gatekeepers can depend on other gatekeepers:

```typescript
test('API is healthy', async ({ page }) => {
  markAs('api');
  // ...
});

test('Authentication works', async ({ page }) => {
  markAs('auth', ['api']);  // 'auth' depends on 'api'
  // ...
});

test('Dashboard loads', async ({ page }) => {
  await dependsOn('auth');  // If 'api' fails, this skips too
  // ...
});
```

---

## How It Works

1. **Global setup** initializes a shared state file before tests run
2. **Gatekeepers** register themselves with `markAs()` and record pass/fail results
3. **Dependent tests** call `await dependsOn()` which:
   - **Waits** (polls) until the gatekeeper completes
   - **Checks** the result
   - **Skips** the test if the gatekeeper failed
4. **File locking** ensures concurrent workers don't corrupt the state
5. **Reporter** shows a summary of what failed and what was skipped

```
┌─────────────────────────────────────────────────────────────────┐
│  Worker 1                    │  Worker 2                       │
├──────────────────────────────┼─────────────────────────────────┤
│  API is healthy              │  Dashboard loads...             │
│    └─ markAs('api')          │    └─ await dependsOn('auth')   │
│    └─ test runs...           │       └─ waiting for auth...    │
│    └─ PASS → write to file   │       └─ still waiting...       │
│                              │                                 │
│  Auth works                  │       └─ auth done! checking... │
│    └─ markAs('auth')         │       └─ auth passed, continue  │
│    └─ PASS → write to file   │    └─ page.goto('/dashboard')   │
└──────────────────────────────┴─────────────────────────────────┘
```

---

## Example Output

```
Running 11 tests using 7 workers

  ✓  1 › Gatekeepers › API is healthy
  ✓  2 › Gatekeepers › Authentication works
  ✓  3 › Gatekeepers › Database connection
  ✘  4 › Gatekeepers › Intentionally failing gatekeeper
  ✓  5 › Dashboard Features › Dashboard loads correctly
  ✓  6 › Dashboard Features › User profile displays
  ✓  7 › Settings Features › Settings page loads
  -  8 › Chain Dependency Example › Test depending on failing gatekeeper  ← SKIPPED

══════════════════════════════════════════════════════════════════════
  DEPENDENCY ORCHESTRATION SUMMARY
══════════════════════════════════════════════════════════════════════

  Total: 11 | Passed: 9 | Failed: 1 | Skipped: 1

  Gatekeepers: 4 registered | 3 passed | 1 failed

  ❌ Failed Gatekeepers:
     • will-fail: Expected pattern: /This Will Not Match/

  ⏭️  Tests skipped due to dependencies: 1

     Due to 'will-fail' failure:
       - Test depending on failing gatekeeper

══════════════════════════════════════════════════════════════════════
```

---

## API Reference

### `markAs(key: string, dependencies?: string[])`

Register the current test as a gatekeeper.

```typescript
markAs('auth');                    // Simple gatekeeper
markAs('dashboard', ['auth']);     // Gatekeeper that depends on another
```

### `await dependsOn(...keys: string[])`

Wait for gatekeepers and skip if any failed. **Must be awaited.**

```typescript
await dependsOn('auth');              // Single dependency
await dependsOn('auth', 'api', 'db'); // Multiple dependencies
```

## Configuration

The orchestration uses these files (auto-created, gitignored):
- `.playwright-gatekeeper-state.json` - Shared state between workers
- `.playwright-gatekeeper-state.lock` - File lock for concurrent access

Default timeout for `dependsOn()` is 30 seconds. Override with:
```typescript
await dependsOn('slow-gatekeeper', 60000);  // 60 second timeout
```

Add to your `.gitignore`:
```
.playwright-gatekeeper-state.json
.playwright-gatekeeper-state.json.tmp.*
.playwright-gatekeeper-state.lock
```

---

## Using with trackedTest

For automatic result tracking, use `trackedTest` instead of `test`:

```typescript
import { trackedTest as test, markAs, dependsOn } from 'playwright-gatekeeper';

// Results are automatically recorded when the test completes
test('Auth works', async ({ page }) => {
  markAs('auth');
  // ...
});
```

---

## License

MIT

---

<sub>

Designed and developed by [![GitHub](https://img.shields.io/badge/GitHub-semsuddin-181717?logo=github&style=flat-square)](https://github.com/semsuddin)

</sub>
