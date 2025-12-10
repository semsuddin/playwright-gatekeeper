import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from '@playwright/test/reporter';
import { getGlobalState } from './testContext';

interface SkipInfo {
  testTitle: string;
  testFile: string;
  reason: string;
  isDependencySkip: boolean;
}

/**
 * Custom Playwright reporter that provides clear reporting on dependency-based skips
 */
class DependencyReporter implements Reporter {
  private skippedTests: SkipInfo[] = [];
  private dependencySkips: SkipInfo[] = [];
  private passedCount = 0;
  private failedCount = 0;
  private skippedCount = 0;

  onBegin(_config: FullConfig, _suite: Suite): void {
    this.skippedTests = [];
    this.dependencySkips = [];
    this.passedCount = 0;
    this.failedCount = 0;
    this.skippedCount = 0;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status === 'passed') {
      this.passedCount++;
    } else if (result.status === 'failed') {
      this.failedCount++;
    } else if (result.status === 'skipped') {
      this.skippedCount++;

      // Check if this was a dependency-based skip
      const skipAnnotation = test.annotations.find(a => a.type === 'skip');
      const skipReason = skipAnnotation?.description || result.error?.message || 'Unknown reason';
      const isDependencySkip = skipReason.includes('dependency') && skipReason.includes('failed');

      const skipInfo: SkipInfo = {
        testTitle: test.title,
        testFile: test.location.file,
        reason: skipReason,
        isDependencySkip,
      };

      this.skippedTests.push(skipInfo);
      if (isDependencySkip) {
        this.dependencySkips.push(skipInfo);
      }
    }
  }

  onEnd(result: FullResult): void {
    console.log('\n');
    console.log('═'.repeat(70));
    console.log('  DEPENDENCY ORCHESTRATION SUMMARY');
    console.log('═'.repeat(70));

    // Overall stats
    const total = this.passedCount + this.failedCount + this.skippedCount;
    console.log(`\n  Total: ${total} | Passed: ${this.passedCount} | Failed: ${this.failedCount} | Skipped: ${this.skippedCount}`);

    // Gatekeeper summary
    const state = getGlobalState();
    const gatekeeperSummary = state.getSummary();
    const allResults = state.getAllResults();
    const failedGatekeepers = Object.entries(allResults).filter(([_, r]) => !r.passed);

    if (gatekeeperSummary.total > 0) {
      console.log(`\n  Gatekeepers: ${gatekeeperSummary.total} registered | ${gatekeeperSummary.passed} passed | ${gatekeeperSummary.failed} failed`);

      // Show failed gatekeepers (short summary - full details shown above by Playwright)
      if (failedGatekeepers.length > 0) {
        console.log('\n  ❌ Failed Gatekeepers:');
        for (const [key, result] of failedGatekeepers) {
          // Extract first line and strip ANSI codes for clean output
          const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, '');
          const firstLine = stripAnsi(result.error?.split('\n')[0] || '');
          const shortError = firstLine.length > 50
            ? firstLine.substring(0, 50) + '...'
            : firstLine;
          const errorStr = shortError ? `: ${shortError}` : '';
          console.log(`     • ${key}${errorStr}`);
        }
      }
    }

    // Dependency-based skips
    if (this.dependencySkips.length > 0) {
      console.log(`\n  ⏭️  Tests skipped due to dependencies: ${this.dependencySkips.length}`);

      // Group by root cause
      const byReason = new Map<string, SkipInfo[]>();
      for (const skip of this.dependencySkips) {
        // Extract the failed dependency key from the reason
        const match = skip.reason.match(/dependency '([^']+)' failed/);
        const key = match ? match[1] : 'unknown';
        if (!byReason.has(key)) {
          byReason.set(key, []);
        }
        byReason.get(key)!.push(skip);
      }

      for (const [depKey, skips] of byReason) {
        console.log(`\n     Due to '${depKey}' failure:`);
        for (const skip of skips) {
          console.log(`       - ${skip.testTitle}`);
        }
      }
    }

    // Other skips (not dependency-related)
    const otherSkips = this.skippedTests.filter(s => !s.isDependencySkip);
    if (otherSkips.length > 0) {
      console.log(`\n  ⏭️  Other skipped tests: ${otherSkips.length}`);
      for (const skip of otherSkips) {
        console.log(`     • ${skip.testTitle}: ${skip.reason}`);
      }
    }

    console.log('\n' + '═'.repeat(70));

    // Cleanup state file
    try {
      state.cleanup();
    } catch {
      // Ignore cleanup errors
    }
  }

  printsToStdio(): boolean {
    return true;
  }
}

export default DependencyReporter;
