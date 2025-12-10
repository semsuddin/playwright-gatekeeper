# Dependency-Aware Test Orchestration for Playwright

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

## Quick Start

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install

# Run tests
npm test
```

---

## Usage

### Gatekeepers

A **gatekeeper** is a critical test that other tests depend on. Mark it with `markAs()`:

```typescript
import { trackedTest as test, expect, markAs } from '../../src/orchestration';

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
import { trackedTest as test, expect, dependsOn } from '../../src/orchestration';

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

## File Structure

```
├── playwright.config.ts           # Playwright configuration
├── src/orchestration/
│   ├── index.ts                   # Public API exports
│   ├── testContext.ts             # State management with file locking
│   ├── helpers.ts                 # markAs(), dependsOn()
│   ├── fixtures.ts                # trackedTest fixture
│   ├── globalSetup.ts             # Initializes state before tests
│   └── reporter.ts                # Custom summary reporter
└── tests/example/
    ├── 00-gatekeepers.spec.ts     # Example gatekeeper tests
    └── 01-features.spec.ts        # Example dependent tests
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

---

## Configuration

The orchestration uses these files (auto-created, gitignored):
- `.playwright-gatekeeper-state.json` - Shared state between workers
- `.playwright-gatekeeper-state.lock` - File lock for concurrent access

Default timeout for `dependsOn()` is 30 seconds. Override with:
```typescript
await dependsOn('slow-gatekeeper', 60000);  // 60 second timeout
```

---

## Demo

To demonstrate the skip behavior:

1. The example includes an intentionally failing gatekeeper (`will-fail`)
2. Run `npm test` and observe:
   - The failing gatekeeper shows as ✘
   - Dependent tests show as - (skipped)
   - Summary shows why tests were skipped

To test with all passing:

```typescript
// In tests/example/00-gatekeepers.spec.ts, comment out:
// test('Intentionally failing gatekeeper', ...)
```

---

[![GitHub](https://img.shields.io/badge/GitHub-semsuddin-181717?logo=github)](https://github.com/semsuddin)