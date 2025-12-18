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

interface TestInfo {
  title: string;
  status: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  dependsOn: string[];
  isFlaky: boolean;
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
  private testsByDependency: Map<string, TestInfo[]> = new Map();

  onBegin(_config: FullConfig, _suite: Suite): void {
    this.skippedTests = [];
    this.dependencySkips = [];
    this.passedCount = 0;
    this.failedCount = 0;
    this.skippedCount = 0;
    this.testsByDependency = new Map();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // Track dependency annotations for tree view
    const dependsOnAnnotation = test.annotations.find(a => a.type === 'depends-on');
    if (dependsOnAnnotation?.description) {
      const keys = dependsOnAnnotation.description.split(',');
      // Test is flaky if it passed but required retries
      const isFlaky = result.status === 'passed' && result.retry > 0;
      const testInfo: TestInfo = {
        title: test.title,
        status: result.status,
        dependsOn: keys,
        isFlaky,
      };

      // Add test under each of its dependencies
      for (const key of keys) {
        if (!this.testsByDependency.has(key)) {
          this.testsByDependency.set(key, []);
        }
        this.testsByDependency.get(key)!.push(testInfo);
      }
    }

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

  onEnd(_result: FullResult): void {
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

    // Render dependency tree if there are any dependencies
    if (this.testsByDependency.size > 0 || gatekeeperSummary.total > 0) {
      this.renderDependencyTree(state);
    }

    console.log('\n' + '═'.repeat(70));

    // Cleanup state file
    try {
      state.cleanup();
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Render the dependency tree showing gatekeepers and their dependent tests
   */
  private renderDependencyTree(state: ReturnType<typeof getGlobalState>): void {
    console.log('\n' + '─'.repeat(70));
    console.log('  DEPENDENCY TREE');
    console.log('─'.repeat(70));

    const allResults = state.getAllResults();
    const allDependencies = this.getAllGatekeeperDependencies(state);

    // Find root gatekeepers (those with no dependencies)
    const rootGatekeepers = Object.keys(allResults).filter(key => {
      const deps = allDependencies.get(key);
      return !deps || deps.length === 0;
    });

    // Also add gatekeepers that only appear as dependencies of others
    for (const [_key, deps] of allDependencies) {
      for (const dep of deps) {
        if (!rootGatekeepers.includes(dep) && !allDependencies.has(dep)) {
          rootGatekeepers.push(dep);
        }
      }
    }

    // Sort root gatekeepers alphabetically
    rootGatekeepers.sort((a, b) => a.localeCompare(b));

    if (rootGatekeepers.length === 0 && this.testsByDependency.size === 0) {
      console.log('\n  No dependency relationships found.');
      return;
    }

    // Track rendered gatekeepers and tests to avoid duplicates
    const renderedGatekeepers = new Set<string>();
    const renderedTests = new Set<string>();

    // Build and render tree for each root gatekeeper
    for (const root of rootGatekeepers) {
      if (!renderedGatekeepers.has(root)) {
        this.renderGatekeeperNode(root, '', true, allResults, allDependencies, renderedGatekeepers, renderedTests);
      }
    }
  }

  /**
   * Get all gatekeeper dependencies from state
   */
  private getAllGatekeeperDependencies(state: ReturnType<typeof getGlobalState>): Map<string, string[]> {
    const deps = new Map<string, string[]>();
    const allResults = state.getAllResults();

    // Read dependencies for each gatekeeper
    for (const key of Object.keys(allResults)) {
      const gatekeeperDeps = state.getDependencies(key);
      if (gatekeeperDeps.length > 0) {
        deps.set(key, gatekeeperDeps);
      }
    }

    return deps;
  }

  /**
   * Collect all children (gatekeepers + tests) for a node, used for proper tree rendering
   */
  private collectNodeChildren(
    key: string,
    allDependencies: Map<string, string[]>,
    renderedGatekeepers: Set<string>
  ): { gatekeepers: string[]; tests: TestInfo[] } {
    // Find child gatekeepers (gatekeepers that depend on this one)
    const gatekeepers = Array.from(allDependencies.entries())
      .filter(([_childKey, deps]) => deps.includes(key))
      .map(([childKey]) => childKey)
      .filter(childKey => !renderedGatekeepers.has(childKey))
      .sort((a, b) => a.localeCompare(b));

    // Get all dependent tests (don't filter - we show all and mark repeats)
    const tests = [...(this.testsByDependency.get(key) || [])]
      .sort((a, b) => a.title.localeCompare(b.title));

    return { gatekeepers, tests };
  }

  /**
   * Render a single gatekeeper node and its children
   */
  private renderGatekeeperNode(
    key: string,
    prefix: string,
    isLast: boolean,
    allResults: Record<string, { passed: boolean; error?: string }>,
    allDependencies: Map<string, string[]>,
    renderedGatekeepers: Set<string>,
    renderedTests: Set<string>
  ): void {
    renderedGatekeepers.add(key);

    const result = allResults[key];
    const statusIcon = result ? (result.passed ? '✓' : '✗') : '?';
    const connector = prefix === '' ? '  ' : (isLast ? '└── ' : '├── ');

    console.log(`${prefix}${connector}${key} ${statusIcon}`);

    const newPrefix = prefix === '' ? '  ' : prefix + (isLast ? '    ' : '│   ');

    // Collect all children for this node
    const { gatekeepers: childGatekeepers, tests: dependentTests } =
      this.collectNodeChildren(key, allDependencies, renderedGatekeepers);

    // Render child gatekeepers
    for (let i = 0; i < childGatekeepers.length; i++) {
      const childKey = childGatekeepers[i];
      const isLastChild = (i === childGatekeepers.length - 1) && (dependentTests.length === 0);
      this.renderGatekeeperNode(childKey, newPrefix, isLastChild, allResults, allDependencies, renderedGatekeepers, renderedTests);
    }

    // Render dependent tests (show all, mark repeats with ⊕)
    for (let i = 0; i < dependentTests.length; i++) {
      const test = dependentTests[i];
      const isRepeat = renderedTests.has(test.title);
      renderedTests.add(test.title);

      const isLastChild = i === dependentTests.length - 1;
      const testConnector = isLastChild ? '└── ' : '├── ';
      const testStatusIcon = this.getStatusIcon(test.status);

      // Show ↺ for flaky tests (passed after retry)
      const flakyMarker = test.isFlaky ? '↺' : '';
      // Show ⊕ for repeated tests (multi-dependency)
      const repeatMarker = isRepeat ? ' ⊕' : '';

      console.log(`${newPrefix}${testConnector}${test.title} ${testStatusIcon}${flakyMarker}${repeatMarker}`);
    }
  }

  /**
   * Get status icon for a test result
   */
  private getStatusIcon(status: string): string {
    switch (status) {
      case 'passed': return '✓';
      case 'failed': return '✗';
      case 'skipped': return '⊘';
      case 'timedOut': return '⏱';
      case 'interrupted': return '⚡';
      default: return '?';
    }
  }

  printsToStdio(): boolean {
    return true;
  }
}

export default DependencyReporter;
